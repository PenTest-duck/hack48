// TEMPLATE — not compiled (lives outside the DataCollector/ source folder).
//
// On a fresh clone, copy this file to:
//     DataCollector/Config/SupabaseConfig.swift
// and fill in your project's values. The real file is git-ignored so keys
// never get committed.

import Foundation

enum SupabaseConfig {
    static let url = URL(string: "https://<your-project-ref>.supabase.co")!
    static let anonKey = "<your-anon-key>"
    static let publishableKey = "<your-publishable-key>"
    static let recordingsBucket = "recordings"

    // Gemini Live (real-time coaching). Leave "" to disable. ⚠️ raw key in-app is
    // demo-only — use ephemeral tokens from a backend for production.
    static let geminiAPIKey = ""
    static let geminiLiveModel = "models/gemini-3.1-flash-live-preview"
}
