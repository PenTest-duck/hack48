import SwiftUI
import SwiftData
import UIKit
import AVKit

/// Full-screen LANDSCAPE camera with a record button. Records for a given `job`
/// and inserts a `Recording` into SwiftData when finished. The screen is locked to
/// landscape and the record button is disabled until the phone is held horizontally.
struct RecordView: View {
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @StateObject private var recorder = Recorder()
    var job: Job? = nil

    @State private var isDeviceLandscape = UIDevice.current.orientation.isLandscape
    @State private var review: ReviewClip?

    var body: some View {
        Group {
            switch recorder.phase {
            case .denied:
                ZStack { Color.black.ignoresSafeArea(); deniedView }
            case .idle:
                ZStack { Color.black.ignoresSafeArea(); ProgressView().tint(.white) }
            default:
                ZStack(alignment: .bottom) {
                    CameraPreviewView(recorder: recorder)

                    recordButton
                        .padding(.bottom, 20)
                        .zIndex(1)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.black)
                .overlay(alignment: .top) {
                    if recorder.phase == .recording {
                        timerBadge
                    } else if let job {
                        jobPrompt(job)
                    }
                }
                // Nudge the user to hold the phone horizontally.
                .overlay {
                    if !isDeviceLandscape && recorder.phase != .recording {
                        rotateHint
                    }
                }
            }
        }
        .navigationTitle(job?.title ?? "Record")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .tabBar)
        .onAppear {
            AppOrientation.lock(.landscapeRight)               // require landscape here
            UIDevice.current.beginGeneratingDeviceOrientationNotifications()
            isDeviceLandscape = UIDevice.current.orientation.isLandscape
            recorder.bountyId = job?.id.uuidString
            recorder.onFinished = { recording in
                context.insert(recording)
                try? context.save()
                review = ReviewClip(recording: recording)   // review the clip just captured
            }
            recorder.configureIfNeeded()
        }
        .onDisappear {
            recorder.pause()
            UIDevice.current.endGeneratingDeviceOrientationNotifications()
            AppOrientation.lock(.portrait)                     // restore portrait for the rest of the app
        }
        .onReceive(NotificationCenter.default.publisher(for: UIDevice.orientationDidChangeNotification)) { _ in
            let orientation = UIDevice.current.orientation
            if orientation.isValidInterfaceOrientation {
                isDeviceLandscape = orientation.isLandscape
            }
        }
        .fullScreenCover(item: $review) { clip in
            reviewView(clip.recording)
        }
    }

    /// Shown right after a recording (WhatsApp-style): play it back, then Save or Delete.
    private func reviewView(_ rec: Recording) -> some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if let url = rec.videoURL {
                VideoPlayer(player: AVPlayer(url: url))
                    .ignoresSafeArea()
            }
            VStack {
                Spacer()
                HStack(spacing: 56) {
                    // Discard — red circle with an ✗; stays on the camera.
                    VStack(spacing: 6) {
                        Button(role: .destructive) {
                            RecordingStore.deleteBundle(folderName: rec.folderName)
                            context.delete(rec)
                            try? context.save()
                            review = nil
                        } label: {
                            Image(systemName: "xmark")
                                .font(.system(size: 24, weight: .bold))
                                .foregroundStyle(.white)
                                .frame(width: 64, height: 64)
                                .background(.red.opacity(0.9), in: Circle())
                                .overlay(Circle().stroke(.white.opacity(0.25), lineWidth: 1))
                                .shadow(radius: 6)
                        }
                        .buttonStyle(.plain)
                        Text("Discard").font(.caption).foregroundStyle(.white.opacity(0.85))
                    }

                    // Save — green circle with a ✓; goes back to the job screen.
                    VStack(spacing: 6) {
                        Button {
                            review = nil
                            dismiss()
                        } label: {
                            Image(systemName: "checkmark")
                                .font(.system(size: 30, weight: .bold))
                                .foregroundStyle(.white)
                                .frame(width: 76, height: 76)
                                .background(Color.green, in: Circle())
                                .overlay(Circle().stroke(.white.opacity(0.3), lineWidth: 1))
                                .shadow(color: .green.opacity(0.6), radius: 10)
                        }
                        .buttonStyle(.plain)
                        Text("Save").font(.caption.weight(.semibold)).foregroundStyle(.white)
                    }
                }
                .padding(.bottom, 28)
            }
        }
    }

    private var rotateHint: some View {
        VStack(spacing: 12) {
            Image(systemName: "rotate.right.fill")
                .font(.system(size: 44))
            Text("Hold your phone sideways to record")
                .font(.headline)
        }
        .foregroundStyle(.white)
        .padding(28)
        .background(.black.opacity(0.7), in: RoundedRectangle(cornerRadius: 18))
    }

    private func jobPrompt(_ job: Job) -> some View {
        VStack(spacing: 2) {
            Text("Record: \(job.title)").font(.subheadline.weight(.semibold))
            if let desc = job.description, !desc.isEmpty {
                Text(desc).font(.caption).foregroundStyle(.white.opacity(0.85)).lineLimit(2)
            }
        }
        .foregroundStyle(.white)
        .multilineTextAlignment(.center)
        .padding(.horizontal, 14).padding(.vertical, 8)
        .background(.black.opacity(0.45), in: Capsule())
        .padding(.top, 8)
    }

    private var timerBadge: some View {
        Text(timeString(recorder.elapsed))
            .font(.system(.title3, design: .monospaced).weight(.semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, 14).padding(.vertical, 6)
            .background(.red, in: Capsule())
            .padding(.top, 8)
    }

    private var recordButton: some View {
        Button(action: recorder.toggle) {
            ZStack {
                Circle().stroke(.white, lineWidth: 5).frame(width: 80, height: 80)
                RoundedRectangle(cornerRadius: recorder.phase == .recording ? 7 : 34)
                    .fill(.red)
                    .frame(width: recorder.phase == .recording ? 36 : 68,
                           height: recorder.phase == .recording ? 36 : 68)
                    .animation(.easeInOut(duration: 0.2), value: recorder.phase)
            }
            .opacity(canRecord || recorder.phase == .recording ? 1 : 0.4)
        }
        // Allow stopping anytime; only allow starting when ready AND held landscape.
        .disabled(!(recorder.phase == .recording || canRecord))
    }

    private var canRecord: Bool {
        recorder.phase == .ready && isDeviceLandscape
    }

    private var deniedView: some View {
        VStack(spacing: 12) {
            Image(systemName: "video.slash.fill").font(.largeTitle).foregroundStyle(.white)
            Text("Camera access needed").font(.headline).foregroundStyle(.white)
            Text("Enable Camera, Location and Motion access in Settings to record.")
                .font(.subheadline).foregroundStyle(.white.opacity(0.7))
                .multilineTextAlignment(.center)
            Button("Open Settings") {
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    UIApplication.shared.open(url)
                }
            }
            .buttonStyle(.borderedProminent)
        }
        .padding()
    }

    private func timeString(_ t: TimeInterval) -> String {
        String(format: "%02d:%02d", Int(t) / 60, Int(t) % 60)
    }
}

/// Wrapper so a just-recorded clip can drive `.fullScreenCover(item:)`.
private struct ReviewClip: Identifiable {
    let id = UUID()
    let recording: Recording
}
