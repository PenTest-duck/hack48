import Foundation
import Supabase

/// Read-side of the marketplace: review status of submissions + earnings.

// MARK: - Earnings

struct Earning: Decodable {
    let amount: Double
    let status: String   // "pending" | "approved"
}

enum EarningsService {
    static func fetch() async throws -> [Earning] {
        guard let uid = Backend.supabase.auth.currentUser?.id else { return [] }
        return try await Backend.supabase
            .from("earnings")
            .select("amount,status")
            .eq("collector_id", value: uid.uuidString)
            .execute()
            .value
    }
}

// MARK: - Submission review status

private struct SubmissionRow: Decodable {
    let storage_path: String
    let status: String
}

enum SubmissionsService {
    /// Map of recordingId (lowercased) → review status, for one task's submissions.
    static func statuses(taskId: String) async throws -> [String: String] {
        let rows: [SubmissionRow] = try await Backend.supabase
            .from("submissions")
            .select("storage_path,status")
            .eq("task_id", value: taskId)
            .execute()
            .value
        var map: [String: String] = [:]
        for row in rows {
            // storage_path is "<recordingId>/" → strip the slash.
            map[row.storage_path.replacingOccurrences(of: "/", with: "")] = row.status
        }
        return map
    }
}
