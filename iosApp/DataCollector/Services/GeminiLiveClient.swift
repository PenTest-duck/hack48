import Foundation

/// Minimal client for the Gemini Live API (BidiGenerateContent over WebSocket).
/// Streams JPEG frames as realtime video input and surfaces the model's short
/// text "coaching tips". Everything stays on the main actor so the UI can bind
/// directly; the WebSocket callbacks hop back to main.
@MainActor
final class GeminiLiveClient: ObservableObject {
    enum Status: Equatable {
        case idle, connecting, ready, closed
        case error(String)
    }

    @Published private(set) var status: Status = .idle
    @Published private(set) var latestTip: String = ""
    @Published private(set) var log: [String] = []   // raw events, for debugging

    var isReady: Bool { if case .ready = status { return true }; return false }

    private var socket: URLSessionWebSocketTask?
    private var session: URLSession?
    private var partial = ""          // accumulates a turn's text (streamed to latestTip)
    private var isOpen = false
    private var awaitingSince: Date?  // set when a tip is requested, cleared on turnComplete
    private var frameInFlight = false // drop frames while a send is still pending

    // MARK: - Lifecycle

    func connect(systemInstruction: String) {
        let key = SupabaseConfig.geminiAPIKey
        guard !key.isEmpty else {
            status = .error("No Gemini key. Paste one into SupabaseConfig.swift (geminiAPIKey).")
            return
        }
        status = .connecting
        partial = ""
        latestTip = ""

        let host = "generativelanguage.googleapis.com"
        let path = "/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent"
        guard let url = URL(string: "wss://\(host)\(path)?key=\(key)") else {
            status = .error("Bad WebSocket URL"); return
        }
        let session = URLSession(configuration: .default)
        let socket = session.webSocketTask(with: url)
        self.session = session
        self.socket = socket
        isOpen = true
        socket.resume()
        addLog("connecting…")
        receiveLoop()
        sendSetup(systemInstruction: systemInstruction)
    }

    func disconnect() {
        guard isOpen else { return }
        isOpen = false
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        session?.invalidateAndCancel()
        session = nil
        awaitingSince = nil
        frameInFlight = false
        status = .closed
        addLog("closed")
    }

    // MARK: - Sending

    private func sendSetup(systemInstruction: String) {
        let setup: [String: Any] = [
            "setup": [
                "model": SupabaseConfig.geminiLiveModel,
                "generationConfig": ["responseModalities": ["TEXT"]],
                "systemInstruction": ["parts": [["text": systemInstruction]]],
            ]
        ]
        send(setup, label: "setup")
    }

    /// Send one downscaled JPEG frame as realtime video input (keep to ≤1 FPS).
    /// Drops the frame if a previous send hasn't completed, so a slow uplink can't
    /// pile up requests (the cause of "request timed out").
    func sendFrame(_ jpeg: Data) {
        guard isOpen, isReady, !frameInFlight, let socket else { return }
        let payload: [String: Any] = [
            "realtimeInput": ["video": ["data": jpeg.base64EncodedString(), "mimeType": "image/jpeg"]]
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let text = String(data: data, encoding: .utf8) else { return }
        frameInFlight = true
        socket.send(.string(text)) { [weak self] error in
            Task { @MainActor in
                self?.frameInFlight = false
                if let error { self?.addLog("frame send err: \(error.localizedDescription)") }
            }
        }
    }

    /// Nudge the model to produce one short tip from the frames seen so far — but
    /// only if we're not already waiting on a turn (with a 6s safety cap so a
    /// dropped turn can't wedge it). Keeps cadence tight without overlapping.
    func requestTip(_ prompt: String) {
        guard isOpen, isReady else { return }
        if let since = awaitingSince, Date().timeIntervalSince(since) < 6 { return }
        awaitingSince = Date()
        send(["realtimeInput": ["text": prompt]], label: "ask")
    }

    private func send(_ json: [String: Any], label: String?) {
        guard let socket,
              let data = try? JSONSerialization.data(withJSONObject: json),
              let text = String(data: data, encoding: .utf8) else { return }
        socket.send(.string(text)) { [weak self] error in
            guard let error else {
                if let label { Task { @MainActor in self?.addLog("→ \(label)") } }
                return
            }
            Task { @MainActor in self?.addLog("send error: \(error.localizedDescription)") }
        }
    }

    // MARK: - Receiving

    private func receiveLoop() {
        socket?.receive { [weak self] result in
            Task { @MainActor in
                guard let self else { return }
                switch result {
                case .failure(let error):
                    self.addLog("recv error: \(error.localizedDescription)")
                    self.awaitingSince = nil
                    if self.isOpen { self.status = .error(error.localizedDescription) }
                case .success(let message):
                    switch message {
                    case .data(let data):   self.handle(data)
                    case .string(let text): self.handle(Data(text.utf8))
                    @unknown default:       break
                    }
                    if self.isOpen { self.receiveLoop() }
                }
            }
        }
    }

    private func handle(_ data: Data) {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            addLog("← non-JSON (\(data.count)b)")
            return
        }
        if obj["setupComplete"] != nil {
            status = .ready
            addLog("ready")
            return
        }
        if let server = obj["serverContent"] as? [String: Any] {
            if let modelTurn = server["modelTurn"] as? [String: Any],
               let parts = modelTurn["parts"] as? [[String: Any]] {
                for part in parts {
                    if let text = part["text"] as? String { partial += text }
                }
                let streaming = partial.trimmingCharacters(in: .whitespacesAndNewlines)
                if !streaming.isEmpty { latestTip = streaming }   // render tokens as they arrive
            }
            if (server["turnComplete"] as? Bool) == true {
                let tip = partial.trimmingCharacters(in: .whitespacesAndNewlines)
                if !tip.isEmpty { addLog("tip: \(tip)") }
                partial = ""
                awaitingSince = nil          // ready for the next nudge
            }
            return
        }
        // Surface anything else (errors, goAway, usage) so we can debug the schema.
        addLog("← \(String(data: data, encoding: .utf8)?.prefix(180) ?? "?")")
    }

    private func addLog(_ line: String) {
        log.append(line)
        if log.count > 50 { log.removeFirst(log.count - 50) }
    }
}
