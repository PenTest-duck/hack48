import Foundation
import ARKit
import AVFoundation
import QuartzCore
import UIKit
import simd

/// Orchestrates a single recording using ARKit as the capture source:
/// RGB video (encoded to .mp4 via AVAssetWriter) + 6DoF camera pose + camera
/// intrinsics + IMU + GPS, all into one bundle on disk.
///
/// ARKit's `ARWorldTrackingConfiguration` fuses camera + IMU (visual-inertial
/// odometry) to give a ground-truth camera trajectory — the data differentiator.
final class Recorder: NSObject, ObservableObject {
    enum Phase: Equatable { case idle, ready, recording, finishing, denied }

    @Published private(set) var phase: Phase = .idle
    @Published private(set) var elapsed: TimeInterval = 0

    private weak var arSession: ARSession?
    private let delegateQueue = DispatchQueue(label: "recorder.ar.delegate")
    private let motion = MotionRecorder()
    private let location = LocationProvider()

    // Video writer (set up lazily on the first frame, once we know its size).
    private var assetWriter: AVAssetWriter?
    private var videoInput: AVAssetWriterInput?
    private var pixelAdaptor: AVAssetWriterInputPixelBufferAdaptor?
    private var writerStarted = false
    private var videoCodec = "h264"

    // Per-frame pose stream + one-shot intrinsics.
    private var poseHandle: FileHandle?
    private var wroteIntrinsics = false

    // LiDAR depth stream (throttled to keep file size sane).
    private var depthHandle: FileHandle?
    private var lastDepthWrite: TimeInterval = 0
    private var depthWidth = 0
    private var depthHeight = 0
    private let depthInterval: TimeInterval = 1.0 / 10.0   // ~10 fps

    private var bundle: RecordingBundle?
    private var startWall = Date()
    private var startMono: TimeInterval = 0
    private var firstFrameTime: TimeInterval?
    private var lastFrameTime: TimeInterval = 0
    private var isRecording = false
    private var timer: Timer?

    private let deviceInfo: RecordingMetadata.Device = {
        let d = UIDevice.current
        return .init(model: d.model, systemName: d.systemName, systemVersion: d.systemVersion)
    }()

    /// Invoked on the main thread once a recording is fully written to disk.
    var onFinished: ((Recording) -> Void)?

    /// The job/bounty this recording fulfils. Set before recording starts.
    var bountyId: String?

    private func setPhase(_ newPhase: Phase) {
        DispatchQueue.main.async { self.phase = newPhase }
    }

    // MARK: - Setup

    func configureIfNeeded() {
        guard phase == .idle else { return }
        location.requestPermission()
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            setPhase(.ready)
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                self?.setPhase(granted ? .ready : .denied)
            }
        default:
            setPhase(.denied)
        }
    }

    /// Called by the preview (`CameraPreviewView`) with the ARSCNView's session.
    /// We become its delegate to receive frames, and start world tracking.
    func attach(to session: ARSession) {
        guard arSession !== session else { return }
        arSession = session
        session.delegate = self
        session.delegateQueue = delegateQueue
        let config = ARWorldTrackingConfiguration()
        config.worldAlignment = .gravity
        // Smaller files: prefer the lowest frame-rate, then lowest-resolution format.
        if let format = ARWorldTrackingConfiguration.supportedVideoFormats.min(by: {
            $0.framesPerSecond != $1.framesPerSecond
                ? $0.framesPerSecond < $1.framesPerSecond
                : $0.imageResolution.width * $0.imageResolution.height
                    < $1.imageResolution.width * $1.imageResolution.height
        }) {
            config.videoFormat = format
        }
        if ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) {
            config.frameSemantics.insert(.sceneDepth) // LiDAR depth (Pro devices)
        }
        session.run(config)
    }

    /// Pause the AR session (e.g. when leaving the record screen) to free the camera.
    func pause() {
        arSession?.pause()
    }

    // MARK: - Record / stop

    func toggle() {
        switch phase {
        case .ready:     start()
        case .recording: stop()
        default:         break
        }
    }

    private func start() {
        guard let bundle = try? RecordingStore.makeBundle() else { return }
        self.bundle = bundle
        startWall = Date()
        startMono = CACurrentMediaTime()
        firstFrameTime = nil
        lastFrameTime = 0
        wroteIntrinsics = false
        writerStarted = false
        depthWidth = 0
        depthHeight = 0
        lastDepthWrite = 0
        elapsed = 0

        FileManager.default.createFile(atPath: bundle.posesURL.path, contents: nil)
        poseHandle = try? FileHandle(forWritingTo: bundle.posesURL)

        location.start()
        motion.start(writingTo: bundle.imuURL)
        isRecording = true
        setPhase(.recording)

        // Timer is scheduled on the main run loop, so it fires on the main thread.
        timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            guard let self else { return }
            self.elapsed = CACurrentMediaTime() - self.startMono
        }
    }

    private func stop() {
        guard isRecording else { return }
        isRecording = false
        setPhase(.finishing)
        timer?.invalidate(); timer = nil
        motion.stop()
        location.stop()

        delegateQueue.async { [weak self] in
            guard let self else { return }
            try? self.poseHandle?.close()
            self.poseHandle = nil
            try? self.depthHandle?.close()
            self.depthHandle = nil

            guard let writer = self.assetWriter, let input = self.videoInput, self.writerStarted else {
                self.completeRecording()
                return
            }
            input.markAsFinished()
            writer.finishWriting { [weak self] in
                self?.completeRecording()
            }
        }
    }

    // MARK: - Finalize

    private func completeRecording() {
        assetWriter = nil; videoInput = nil; pixelAdaptor = nil; writerStarted = false
        guard let bundle else { setPhase(.ready); return }

        let durationMs = Int((lastFrameTime - (firstFrameTime ?? lastFrameTime)) * 1000)
        let gps = location.lastLocation.map {
            RecordingMetadata.GPS(lat: $0.coordinate.latitude,
                                  lon: $0.coordinate.longitude,
                                  accuracyM: $0.horizontalAccuracy)
        }
        // Only list files that actually got written.
        let streams = bundle.streamFilenames.filter {
            FileManager.default.fileExists(atPath: bundle.folderURL.appendingPathComponent($0).path)
        }
        let metadata = RecordingMetadata(
            recordingId: bundle.id.uuidString,
            bountyId: bountyId,
            startedAt: ISO8601DateFormatter().string(from: startWall),
            startMonotonic: startMono,
            durationMs: durationMs,
            device: deviceInfo,
            video: .init(file: bundle.videoURL.lastPathComponent, container: "mp4", codec: videoCodec),
            gps: gps,
            depth: depthWidth > 0
                ? .init(file: bundle.depthURL.lastPathComponent,
                        width: depthWidth, height: depthHeight, dtype: "float32",
                        layout: "per-frame: float64 timestamp (LE) then width*height row-major float32 metres")
                : nil,
            streams: streams,
            schemaVersion: 3
        )
        try? RecordingStore.writeMetadata(metadata, to: bundle.metadataURL)
        RecordingStore.excludeFromBackup(bundle.folderURL)

        let size = RecordingStore.directorySize(bundle.folderURL)
        let id = bundle.id
        let createdAt = startWall
        // Re-read streams now that metadata.json exists.
        let finalStreams = bundle.streamFilenames.filter {
            FileManager.default.fileExists(atPath: bundle.folderURL.appendingPathComponent($0).path)
        }
        self.bundle = nil

        DispatchQueue.main.async {
            let recording = Recording(
                id: id,
                bountyId: self.bountyId,
                createdAt: createdAt,
                durationMs: durationMs,
                sizeBytes: size,
                gpsLat: gps?.lat,
                gpsLon: gps?.lon,
                gpsAccuracyM: gps?.accuracyM,
                folderName: id.uuidString,
                streams: finalStreams,
                status: .local
            )
            self.onFinished?(recording)
            self.phase = .ready
        }
    }

    // MARK: - Per-frame writers

    private func setupWriter(for pixelBuffer: CVPixelBuffer, to url: URL, startTime: TimeInterval) {
        let width = CVPixelBufferGetWidth(pixelBuffer)
        let height = CVPixelBufferGetHeight(pixelBuffer)
        guard let writer = try? AVAssetWriter(outputURL: url, fileType: .mp4) else { return }
        writer.shouldOptimizeForNetworkUse = true // moov atom at front → web-streamable

        let settings: [String: Any] = [
            AVVideoCodecKey: AVVideoCodecType.h264, // universal browser playback (Chrome/Firefox can't do HEVC)
            AVVideoWidthKey: width,
            AVVideoHeightKey: height,
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: 6_000_000, // ~6 Mbps cap → smaller video
            ],
        ]
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
        input.expectsMediaDataInRealTime = true
        input.transform = .identity // record in landscape (record screen is locked to landscape)

        let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: nil)
        if writer.canAdd(input) { writer.add(input) }
        writer.startWriting()
        writer.startSession(atSourceTime: CMTime(seconds: startTime, preferredTimescale: 1_000_000))

        assetWriter = writer
        videoInput = input
        pixelAdaptor = adaptor
        firstFrameTime = startTime
        writerStarted = (writer.status == .writing)
    }

    private func appendPose(_ frame: ARFrame, at t: TimeInterval) {
        guard let handle = poseHandle else { return }
        let m = frame.camera.transform
        let p = m.columns.3
        let q = simd_quatf(m)
        let row: [String: Double] = [
            "t": t,
            "px": Double(p.x), "py": Double(p.y), "pz": Double(p.z),
            "qw": Double(q.real), "qx": Double(q.imag.x), "qy": Double(q.imag.y), "qz": Double(q.imag.z),
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: row) else { return }
        handle.write(data)
        handle.write(Data("\n".utf8))
    }

    /// Appends one LiDAR depth frame to depth.bin:
    /// [Float64 timestamp (LE)] + [width*height row-major Float32 metres].
    private func appendDepth(_ depthMap: CVPixelBuffer, at t: TimeInterval, to url: URL) {
        if depthHandle == nil {
            FileManager.default.createFile(atPath: url.path, contents: nil)
            depthHandle = try? FileHandle(forWritingTo: url)
        }
        guard let handle = depthHandle else { return }
        CVPixelBufferLockBaseAddress(depthMap, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(depthMap, .readOnly) }
        let width = CVPixelBufferGetWidth(depthMap)
        let height = CVPixelBufferGetHeight(depthMap)
        let bytesPerRow = CVPixelBufferGetBytesPerRow(depthMap)
        guard let base = CVPixelBufferGetBaseAddress(depthMap) else { return }
        depthWidth = width
        depthHeight = height

        let rowBytes = width * MemoryLayout<Float32>.size
        var data = Data(capacity: MemoryLayout<Double>.size + rowBytes * height)
        var ts = t
        withUnsafeBytes(of: &ts) { data.append(contentsOf: $0) }
        for row in 0..<height {
            data.append(Data(bytes: base.advanced(by: row * bytesPerRow), count: rowBytes))
        }
        handle.write(data)
    }

    private func writeIntrinsics(_ frame: ARFrame, to url: URL) {
        let k = frame.camera.intrinsics
        let res = frame.camera.imageResolution
        let dict: [String: Double] = [
            "fx": Double(k.columns.0.x),
            "fy": Double(k.columns.1.y),
            "cx": Double(k.columns.2.x),
            "cy": Double(k.columns.2.y),
            "width": Double(res.width),
            "height": Double(res.height),
        ]
        if let data = try? JSONSerialization.data(withJSONObject: dict, options: [.prettyPrinted, .sortedKeys]) {
            try? data.write(to: url)
        }
    }
}

extension Recorder: ARSessionDelegate {
    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        guard isRecording, let bundle else { return }
        let t = frame.timestamp
        lastFrameTime = t

        if !wroteIntrinsics {
            wroteIntrinsics = true
            writeIntrinsics(frame, to: bundle.intrinsicsURL)
        }
        if assetWriter == nil {
            setupWriter(for: frame.capturedImage, to: bundle.videoURL, startTime: t)
        }
        if writerStarted, let adaptor = pixelAdaptor, let input = videoInput, input.isReadyForMoreMediaData {
            adaptor.append(frame.capturedImage,
                           withPresentationTime: CMTime(seconds: t, preferredTimescale: 1_000_000))
        }
        appendPose(frame, at: t)

        if let sceneDepth = frame.sceneDepth, t - lastDepthWrite >= depthInterval {
            lastDepthWrite = t
            appendDepth(sceneDepth.depthMap, at: t, to: bundle.depthURL)
        }
    }

    func session(_ session: ARSession, didFailWithError error: Error) {
        setPhase(.denied)
    }
}
