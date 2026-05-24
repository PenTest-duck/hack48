import SwiftUI
import AVKit

/// Tap a recording to see it play back plus its AI quality score + reasoning.
/// Polls while the score is still being computed by the microservice.
struct RecordingDetailView: View {
    let recording: Recording
    let taskId: String

    @Environment(\.dismiss) private var dismiss
    @State private var score: RecordingScore?
    @State private var loading = true

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    if let url = recording.videoURL {
                        VideoPlayer(player: AVPlayer(url: url))
                            .frame(height: 220)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                    scoreCard
                    metaCard
                }
                .padding()
            }
            .background(Color.appBackground.ignoresSafeArea())
            .navigationTitle("Recording")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } }
            }
            .task { await load() }
        }
    }

    // MARK: - Score

    @ViewBuilder
    private var scoreCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Quality score").font(.headline)

            if recording.status != .uploaded {
                hint("Upload this recording to get it scored.")
            } else if let s = score, !s.isScoring, let value = s.score {
                let passed = s.success ?? (value >= 5)
                HStack(spacing: 12) {
                    Text("\(scoreText(value))/10")
                        .font(.system(size: 40, weight: .bold))
                        .foregroundStyle(passed ? Color.appCollector : Color.appDanger)
                    Label(passed ? "Passed" : "Failed",
                          systemImage: passed ? "checkmark.seal.fill" : "xmark.seal.fill")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(passed ? Color.appCollector : Color.appDanger)
                }
                if let r = s.scoreReasoning, !r.isEmpty { reason("Score notes", r) }
            } else {
                HStack(spacing: 8) {
                    ProgressView()
                    Text("Scoring in progress…").foregroundStyle(.secondary)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(Color.appSurface, in: RoundedRectangle(cornerRadius: 12))
    }

    private func reason(_ title: String, _ text: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            Text(text).font(.subheadline)
        }
    }

    private func hint(_ text: String) -> some View {
        Text(text).font(.subheadline).foregroundStyle(.secondary)
    }

    private func scoreText(_ value: Double) -> String {
        value == value.rounded() ? String(Int(value)) : String(format: "%.1f", value)
    }

    // MARK: - Meta

    private var metaCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Details").font(.headline)
            LabeledContent("Duration", value: RecordingFormat.duration(recording.durationMs))
            LabeledContent("Size", value: RecordingFormat.size(recording.sizeBytes))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(Color.appSurface, in: RoundedRectangle(cornerRadius: 12))
    }

    // MARK: - Load + poll

    private func load() async {
        guard recording.status == .uploaded else { loading = false; return }
        await refresh()
        loading = false
        // Keep polling while the model hasn't returned a score yet.
        while !Task.isCancelled, (score?.isScoring ?? true), score?.score == nil {
            try? await Task.sleep(for: .seconds(4))
            await refresh()
        }
    }

    private func refresh() async {
        let map = (try? await ScoringService.scores(taskId: taskId)) ?? [:]
        let mine = map[recording.id.uuidString.lowercased()]
        await MainActor.run { score = mine }
    }
}
