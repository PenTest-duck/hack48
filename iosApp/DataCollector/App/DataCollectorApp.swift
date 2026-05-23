import SwiftUI
import SwiftData

/// App entry point. Sets up the SwiftData store that tracks recordings.
@main
struct DataCollectorApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .modelContainer(for: Recording.self)
    }
}
