import SwiftUI
import SwiftData

/// Root view. Shows sign-in until authenticated, then the app:
/// browse Jobs → record → manage/upload Recordings.
struct ContentView: View {
    @StateObject private var auth = AuthManager()

    var body: some View {
        Group {
            if auth.isAuthenticated {
                JobsView()
            } else {
                AuthView()
            }
        }
        .environmentObject(auth)
    }
}

#Preview {
    ContentView()
        .modelContainer(for: Recording.self, inMemory: true)
}
