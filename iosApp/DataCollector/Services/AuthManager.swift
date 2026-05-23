import Foundation
import Supabase

/// Minimal auth state wrapper over Supabase Auth (email + password).
@MainActor
final class AuthManager: ObservableObject {
    @Published private(set) var isAuthenticated: Bool

    init() {
        isAuthenticated = Backend.supabase.auth.currentSession != nil
    }

    func signIn(email: String, password: String) async throws {
        _ = try await Backend.supabase.auth.signIn(email: email, password: password)
        refresh()
    }

    func signUp(email: String, password: String, fullName: String) async throws {
        // Pass the name as user metadata so the `handle_new_user` trigger can
        // populate the required column in `profiles`. We send both common keys
        // (`full_name` and `name`) so whichever the trigger reads is present.
        _ = try await Backend.supabase.auth.signUp(
            email: email,
            password: password,
            data: [
                "full_name": .string(fullName),
                "name": .string(fullName),
                // This app is for data collectors; the `profiles` trigger requires a role.
                // (Web test accounts collector@test.com / lab@test.com imply these values.)
                "role": .string("collector"),
            ]
        )
        refresh()
    }

    func signOut() async {
        try? await Backend.supabase.auth.signOut()
        refresh()
    }

    private func refresh() {
        isAuthenticated = Backend.supabase.auth.currentSession != nil
    }
}
