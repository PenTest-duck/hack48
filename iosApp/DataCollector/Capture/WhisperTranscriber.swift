import Foundation
import AVFoundation
import WhisperKit

/// On-device speech-to-text with WhisperKit (CoreML). Runs AFTER recording on the
/// clip's audio, so the camera is already off — no camera/GPU conflict. Whisper's
/// own segments carry real start/end times. First run downloads the model (~150MB).
enum WhisperTranscriber {
    /// One phrase segment, timed from the start of the audio.
    struct Segment: Codable {
        let startTime: Double
        let endTime: Double
        let text: String
        enum CodingKeys: String, CodingKey {
            case startTime = "start_time"
            case endTime = "end_time"
            case text
        }
    }

    /// English base model — good accuracy/size balance (~150MB).
    private static let model = "base.en"

    /// Transcribe a recorded video's audio. Returns (segments, status).
    static func transcribe(videoURL: URL) async -> ([Segment], String) {
        guard let audioURL = await extractAudio(from: videoURL) else {
            return ([], "no audio track to transcribe")
        }
        defer { try? FileManager.default.removeItem(at: audioURL) }
        do {
            let whisper = try await WhisperKit(WhisperKitConfig(model: model))
            let results = try await whisper.transcribe(audioPath: audioURL.path)
            let segments = results.flatMap { $0.segments }.compactMap { seg -> Segment? in
                let text = seg.text.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !text.isEmpty else { return nil }
                return Segment(startTime: round2(Double(seg.start)),
                               endTime: round2(Double(seg.end)),
                               text: text)
            }
            return (segments, segments.isEmpty ? "whisper: no speech" : "whisper \(model)")
        } catch {
            return ([], "whisper error: \(error.localizedDescription)")
        }
    }

    /// Extract the audio track to a temp .m4a (WhisperKit reads audio files, not .mp4).
    private static func extractAudio(from videoURL: URL) async -> URL? {
        let asset = AVURLAsset(url: videoURL)
        let tracks = (try? await asset.loadTracks(withMediaType: .audio)) ?? []
        guard !tracks.isEmpty else { return nil }
        let out = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString + ".m4a")
        guard let export = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetAppleM4A) else {
            return nil
        }
        export.outputURL = out
        export.outputFileType = .m4a
        await withCheckedContinuation { cont in
            export.exportAsynchronously { cont.resume() }
        }
        return export.status == .completed ? out : nil
    }

    private static func round2(_ x: Double) -> Double { (x * 100).rounded() / 100 }
}
