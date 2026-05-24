import SwiftUI
import SwiftData

/// Root view. Shows sign-in until authenticated, then the app:
/// Jobs (dashboard) + Profile tabs.
struct ContentView: View {
    @StateObject private var auth = AuthManager()

    var body: some View {
        Group {
            if auth.isAuthenticated {
                TabView {
                    JobsView()
                        .tabItem { Label("Jobs", systemImage: "list.bullet.rectangle") }
                    ProfileView()
                        .tabItem { Label("Profile", systemImage: "person.crop.circle") }
                }
                .tint(.appAccent)
            } else {
                AuthView()
            }
        }
        .environmentObject(auth)
        .preferredColorScheme(.dark)
    }
}

#Preview {
    ContentView()
        .modelContainer(for: Recording.self, inMemory: true)
}
