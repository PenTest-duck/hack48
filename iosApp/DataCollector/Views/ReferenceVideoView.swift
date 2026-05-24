import SwiftUI
import AVKit

/// Plays a task's reference example video. Fetches a signed URL (private bucket),
/// usable by both labs (review) and collectors (see what to record).
struct ReferenceVideoView: View {
    let taskId: String
    @State private var url: URL?
    @State private var loading = true

    var body: some View {
        Group {
            if loading {
                HStack(spacing: 8) {
                    ProgressView()
                    Text("Loading reference…").font(.caption).foregroundStyle(.secondary)
                }
            } else if let url {
                VideoPlayer(player: AVPlayer(url: url))
                    .frame(height: 200)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            } else {
                Text("No reference video yet.").font(.caption).foregroundStyle(.secondary)
            }
        }
        .task { await load() }
    }

    private func load() async {
        let signed = try? await LabTasksService.signedReferenceURL(taskId: taskId)
        await MainActor.run { url = signed ?? nil; loading = false }
    }
}
