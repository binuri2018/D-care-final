/// Default API base for the Memory Aid monorepo (`backend/main.py` on port 8000).
///
/// Override at build/run time, e.g. Android emulator → host:
/// `flutter run --dart-define=MEMORY_AID_API_BASE=http://10.0.2.2:8000/api`
///
/// To point at another API (different routes, e.g. legacy Node on port 4000), set the URL
/// in **Settings** inside the app, or:
/// `flutter run --dart-define=MEMORY_AID_API_BASE=http://127.0.0.1:4000/api`
class BackendConfig {
  BackendConfig._();

  static const String defaultApiBase = String.fromEnvironment(
    'MEMORY_AID_API_BASE',
    defaultValue: 'http://127.0.0.1:8000/api',
  );
}
