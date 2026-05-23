import Foundation
import Supabase

/// Plain-value snapshot of a recording, built on the main thread and handed to the
/// uploader so we never touch a SwiftData model off the main thread.
struct UploadPayload {
    let id: UUID
    let folderName: String
    let streams: [String]
    let bountyId: String?
    let durationMs: Int
    let sizeBytes: Int
    let gpsLat: Double?
    let gpsLon: Double?
    let gpsAccuracyM: Double?
}

/// Uploads a recording bundle to Supabase Storage, then writes its metadata row.
enum UploadService {
    static func upload(_ payload: UploadPayload) async throws {
        let bucket = SupabaseConfig.recordingsBucket
        let folder = RecordingStore.folderURL(for: payload.folderName)

        // 1) Upload each file in the bundle (streamed straight from disk).
        for stream in payload.streams {
            let fileURL = folder.appendingPathComponent(stream)
            let path = "\(payload.id.uuidString)/\(stream)"
            _ = try await Backend.supabase.storage
                .from(bucket)
                .upload(
                    path,
                    fileURL: fileURL,
                    options: FileOptions(contentType: contentType(for: stream), upsert: true)
                )
        }

        // 2) Insert the metadata row pointing at the uploaded bundle.
        let row = RecordingRow(
            id: payload.id.uuidString,
            bounty_id: payload.bountyId,
            duration_ms: payload.durationMs,
            size_bytes: payload.sizeBytes,
            gps_lat: payload.gpsLat,
            gps_lon: payload.gpsLon,
            gps_accuracy_m: payload.gpsAccuracyM,
            storage_path: "\(payload.id.uuidString)/",
            streams: payload.streams,
            status: "uploaded"
        )
        try await Backend.supabase
            .from("recordings")
            .insert(row)
            .execute()
    }

    private static func contentType(for filename: String) -> String {
        if filename.hasSuffix(".mov")   { return "video/quicktime" }
        if filename.hasSuffix(".mp4")   { return "video/mp4" }
        if filename.hasSuffix(".json")  { return "application/json" }
        if filename.hasSuffix(".jsonl") { return "application/x-ndjson" }
        return "application/octet-stream"
    }
}

/// Matches the columns of the public.recordings table (snake_case on purpose).
private struct RecordingRow: Encodable {
    let id: String
    let bounty_id: String?
    let duration_ms: Int
    let size_bytes: Int
    let gps_lat: Double?
    let gps_lon: Double?
    let gps_accuracy_m: Double?
    let storage_path: String
    let streams: [String]
    let status: String
}
