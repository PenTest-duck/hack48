import Foundation
import Supabase

/// Fetches a task's coaching profile (the small `coaching.json` stored next to
/// its reference) so the record screen can coach against that task's example.
enum CoachingService {
    /// Profile + a human-readable diagnostic of how the fetch went (for on-screen debug).
    struct Loaded {
        let profile: CoachingProfile?
        let debug: String
    }

    static func profile(taskId: String) async throws -> CoachingProfile? {
        await load(taskId: taskId).profile
    }

    /// Detailed loader that reports each step: reference_path → coaching.json HTTP
    /// → decode → values. Never throws; failures become a debug string + nil profile.
    static func load(taskId: String) async -> Loaded {
        do {
            guard let path = try await LabTasksService.referencePath(taskId: taskId), !path.isEmpty else {
                return Loaded(profile: nil, debug: "no reference_path on task")
            }
            let filePath = (path.hasSuffix("/") ? path : path + "/") + "coaching.json"
            do {
                let signed = try await Backend.supabase.storage
                    .from(SupabaseConfig.recordingsBucket)
                    .createSignedURL(path: filePath, expiresIn: 3600)
                let (data, response) = try await URLSession.shared.data(from: signed)
                let code = (response as? HTTPURLResponse)?.statusCode ?? 0
                guard (200..<300).contains(code) else {
                    return Loaded(profile: nil, debug: "coaching.json HTTP \(code) (not uploaded?)")
                }
                let p = try JSONDecoder().decode(CoachingProfile.self, from: data)
                return Loaded(profile: p, debug: "loaded \(summary(p))")
            } catch {
                return Loaded(profile: nil, debug: "fetch err: \(error.localizedDescription)")
            }
        } catch {
            return Loaded(profile: nil, debug: "ref path err: \(error.localizedDescription)")
        }
    }

    private static func summary(_ p: CoachingProfile) -> String {
        func f(_ v: Double?) -> String { v.map { String(format: "%.2f", $0) } ?? "nil" }
        return "L\(f(p.luminanceMin))-\(f(p.luminanceMax)) M\(f(p.motionMax)) D\(f(p.distanceMin))-\(f(p.distanceMax))"
    }
}
