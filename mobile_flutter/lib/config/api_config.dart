import "package:flutter/foundation.dart";

/// Central configuration for the backend API base URL.
///
/// Resolution order:
///   1. `--dart-define=API_BASE_URL=...` at build/run time. Required for a
///      **physical phone** (use your PC's LAN IP, e.g. `http://192.168.1.42:8000`).
///   2. Android **emulator** default: `http://10.0.2.2:8000` (maps to the host).
///   3. iOS simulator / other: `http://127.0.0.1:8000`.
///
/// Run the backend with `--host 0.0.0.0` so the phone or emulator can reach it.
///
/// HARD-LEARNED LESSON: do NOT pass the literal placeholder string
/// `YOUR_CURRENT_PC_IP` from documentation. The Dart resolver will happily
/// keep that as the host name, every HTTP call will hit
/// `http://your_current_pc_ip:8000/...`, DNS will fail with `errno = 7`,
/// and every part of the app that depends on the backend (Done button,
/// closed-app notifications, voice TTS) will silently break. The
/// [isMisconfigured] helper detects this case so the UI can show a loud
/// error instead of failing quietly.
class ApiConfig {
  static String get baseUrl {
    const env = String.fromEnvironment("API_BASE_URL");
    if (env.isNotEmpty) return env;
    if (defaultTargetPlatform == TargetPlatform.android) {
      return "http://10.0.2.2:8000";
    }
    return "http://127.0.0.1:8000";
  }

  /// Returns true when the resolved [baseUrl] contains a documentation
  /// placeholder (e.g. `YOUR_CURRENT_PC_IP`, `<PC_LAN_IP>`) instead of a
  /// real IP. Used by the home screen to show a screaming red banner so
  /// the user can fix the launch command.
  static bool get isMisconfigured {
    final lower = baseUrl.toLowerCase();
    const placeholders = <String>[
      "your_current_pc_ip",
      "your_pc_ip",
      "<pc_lan_ip>",
      "<your_pc_ip>",
      "<your-pc-ip>",
      "<pc-lan-ip>",
      "pc_lan_ip",
      "pc-lan-ip",
    ];
    for (final p in placeholders) {
      if (lower.contains(p)) return true;
    }
    return false;
  }
}
