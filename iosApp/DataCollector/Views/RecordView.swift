import SwiftUI
import SwiftData
import UIKit

/// Full-screen camera with a record button. Records for a given `job` and
/// inserts a `Recording` into SwiftData when finished.
struct RecordView: View {
    @Environment(\.modelContext) private var context
    @StateObject private var recorder = Recorder()
    var job: Job? = nil

    var body: some View {
        Group {
            switch recorder.phase {
            case .denied:
                ZStack { Color.black.ignoresSafeArea(); deniedView }
            case .idle:
                ZStack { Color.black.ignoresSafeArea(); ProgressView().tint(.white) }
            default:
                // Preview (ARKit) is created only after permission is granted.
                // Button sits on top via ZStack order + zIndex, inside the safe area.
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
            }
        }
        .navigationTitle(job?.title ?? "Record")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .tabBar)
        .onAppear {
            recorder.bountyId = job?.id.uuidString
            recorder.onFinished = { recording in
                context.insert(recording)
                try? context.save()
            }
            recorder.configureIfNeeded()
        }
        .onDisappear { recorder.pause() }
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
        }
        .disabled(recorder.phase != .ready && recorder.phase != .recording)
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
