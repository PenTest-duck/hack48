import SwiftUI
import SwiftData

/// A job's details + the recordings captured for it (filtered by bountyId),
/// with a Record button pinned at the bottom.
struct JobDetailView: View {
    let job: Job

    @Environment(\.modelContext) private var context
    @Query private var recordings: [Recording]
    @State private var progress: [UUID: Double] = [:]
    @State private var errorMessage: String?
    @State private var pendingDelete: Recording?
    @State private var playing: PlayableVideo?

    init(job: Job) {
        self.job = job
        let jobId: String? = job.id.uuidString
        _recordings = Query(
            filter: #Predicate<Recording> { $0.bountyId == jobId },
            sort: [SortDescriptor(\Recording.createdAt, order: .reverse)]
        )
    }

    var body: some View {
        List {
            Section { jobInfo }
            Section("Your recordings (\(recordings.count))") {
                if recordings.isEmpty {
                    Text("No recordings yet. Tap Record below to capture one.")
                        .font(.subheadline).foregroundStyle(.secondary)
                } else {
                    ForEach(recordings) { rec in row(rec) }
                }
            }
        }
        .navigationTitle(job.title)
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) { recordBar }
        .sheet(item: $playing) { VideoPlayerSheet(url: $0.url) }
        .alert("Upload failed", isPresented: .constant(errorMessage != nil)) {
            Button("OK") { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "")
        }
        .confirmationDialog("Delete this recording?",
                            isPresented: .constant(pendingDelete != nil),
                            titleVisibility: .visible) {
            Button("Delete", role: .destructive) {
                if let rec = pendingDelete { performDelete(rec) }
                pendingDelete = nil
            }
            Button("Cancel", role: .cancel) { pendingDelete = nil }
        }
    }

    // MARK: - Job info

    private var jobInfo: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let amount = job.bountyAmount {
                Text("$\(amount, specifier: "%.0f")")
                    .font(.title3.bold()).foregroundStyle(.green)
            }
            if let desc = job.description, !desc.isEmpty {
                Text(desc).font(.subheadline)
            }
            HStack(spacing: 6) {
                if let dataType = job.dataType { tag(dataType) }
                ForEach(job.requiredCapabilities ?? [], id: \.self) { tag($0) }
            }
            if let needed = job.quantityNeeded {
                Text("\(job.quantityFilled ?? 0)/\(needed) collected")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }

    private func tag(_ text: String) -> some View {
        Text(text)
            .font(.caption2.weight(.medium))
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(Color.gray.opacity(0.15), in: Capsule())
    }

    // MARK: - Recording row

    private func row(_ rec: Recording) -> some View {
        HStack(spacing: 12) {
            if let url = rec.videoURL {
                VideoThumbnail(url: url)
                    .onTapGesture { playing = PlayableVideo(url: url) }
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(rec.createdAt.formatted(date: .abbreviated, time: .shortened))
                    .font(.subheadline.weight(.medium))
                Text("\(RecordingFormat.duration(rec.durationMs)) · \(RecordingFormat.size(rec.sizeBytes))")
                    .font(.caption).foregroundStyle(.secondary)
                Text(rec.status.label)
                    .font(.caption2.weight(.semibold))
                    .padding(.horizontal, 8).padding(.vertical, 2)
                    .background(rec.status.color.opacity(0.18), in: Capsule())
                    .foregroundStyle(rec.status.color)
            }
            Spacer()
            VStack(spacing: 10) {
                if let p = progress[rec.id] {
                    VStack(spacing: 4) {
                        ProgressView(value: p)
                            .progressViewStyle(.linear)
                            .frame(width: 90)
                        Text("\(Int(p * 100))%")
                            .font(.caption2).monospacedDigit()
                            .foregroundStyle(.secondary)
                    }
                } else if rec.status == .local || rec.status == .failed {
                    Button("Upload") { upload(rec) }
                        .buttonStyle(.borderedProminent).controlSize(.small)
                }
                Button(role: .destructive) { pendingDelete = rec } label: {
                    Image(systemName: "trash")
                }
                .buttonStyle(.borderless).tint(.red)
            }
        }
        .padding(.vertical, 2)
    }

    // MARK: - Record button

    private var recordBar: some View {
        NavigationLink {
            RecordView(job: job)
        } label: {
            Label("Record", systemImage: "record.circle")
                .font(.headline)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(.red, in: RoundedRectangle(cornerRadius: 14))
                .foregroundStyle(.white)
        }
        .padding(.horizontal).padding(.vertical, 10)
        .background(.bar)
    }

    // MARK: - Actions

    private func upload(_ rec: Recording) {
        let payload = UploadPayload(
            id: rec.id,
            folderName: rec.folderName,
            streams: rec.streams,
            bountyId: rec.bountyId,
            durationMs: rec.durationMs,
            sizeBytes: rec.sizeBytes,
            gpsLat: rec.gpsLat,
            gpsLon: rec.gpsLon,
            gpsAccuracyM: rec.gpsAccuracyM
        )
        let id = rec.id
        progress[id] = 0
        rec.status = .uploading
        try? context.save()

        Task {
            do {
                try await UploadService.upload(payload) { p in
                    progress[id] = p
                }
                await MainActor.run { rec.status = .uploaded; try? context.save() }
            } catch {
                await MainActor.run {
                    rec.status = .failed
                    errorMessage = error.localizedDescription
                    try? context.save()
                }
            }
            await MainActor.run { progress[id] = nil }
        }
    }

    private func performDelete(_ rec: Recording) {
        RecordingStore.deleteBundle(folderName: rec.folderName)
        context.delete(rec)
        try? context.save()
    }
}
