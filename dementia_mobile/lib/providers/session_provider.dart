import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/config/backend_config.dart';
import '../core/network/api_client.dart';
import '../core/network/socket_service.dart';
import '../core/storage/local_storage.dart';
import '../models/app_user.dart';

class SessionState {
  const SessionState({
    this.loading = true,
    this.token,
    this.user,
    this.apiBaseUrl = BackendConfig.defaultApiBase,
    this.selectedPatientId,
    this.error,
  });

  final bool loading;
  final String? token;
  final AppUser? user;
  final String apiBaseUrl;
  final String? selectedPatientId;
  final String? error;

  bool get isAuthenticated => token != null && user != null;

  SessionState copyWith({
    bool? loading,
    String? token,
    AppUser? user,
    String? apiBaseUrl,
    String? selectedPatientId,
    String? error,
    bool clearError = false,
    bool clearSession = false,
  }) {
    return SessionState(
      loading: loading ?? this.loading,
      token: clearSession ? null : token ?? this.token,
      user: clearSession ? null : user ?? this.user,
      apiBaseUrl: apiBaseUrl ?? this.apiBaseUrl,
      selectedPatientId: clearSession ? null : selectedPatientId ?? this.selectedPatientId,
      error: clearError ? null : error ?? this.error,
    );
  }
}

class SessionController extends StateNotifier<SessionState> {
  SessionController(this._storage, this._socketService) : super(const SessionState()) {
    _init();
  }

  final LocalStorage _storage;
  final SocketService _socketService;

  Future<void> _init() async {
    final token = await _storage.getToken();
    final user = await _storage.getUser();
    final apiBaseUrl = await _storage.getApiBaseUrl();

    String? selectedPatientId;
    if (user != null && user.isGuardian) {
      selectedPatientId = await _storage.getSelectedPatient(guardianUserId: user.id);
    }

    state = state.copyWith(
      loading: false,
      token: token,
      user: user,
      apiBaseUrl: apiBaseUrl,
      selectedPatientId: selectedPatientId,
      clearError: true,
    );

    if (token != null && user != null) {
      _socketService.connect(baseUrl: apiBaseUrl.replaceAll('/api', ''), userId: user.id, role: user.role);
    }
  }

  ApiClient apiClient() => ApiClient(baseUrl: state.apiBaseUrl, token: state.token);

  Future<void> setApiBaseUrl(String value) async {
    await _storage.saveApiBaseUrl(value);
    state = state.copyWith(apiBaseUrl: value);

    final user = state.user;
    if (user != null) {
      _socketService.connect(baseUrl: value.replaceAll('/api', ''), userId: user.id, role: user.role);
    }
  }

  Future<void> setSelectedPatient(String? patientId) async {
    final user = state.user;
    if (user == null || !user.isGuardian) {
      state = state.copyWith(selectedPatientId: null);
      return;
    }

    await _storage.saveSelectedPatient(guardianUserId: user.id, patientId: patientId);
    state = state.copyWith(selectedPatientId: (patientId?.isEmpty ?? true) ? null : patientId);
  }

  Future<bool> register({
    required String fullName,
    required String email,
    required String password,
    required String role,
  }) async {
    try {
      state = state.copyWith(loading: true, clearError: true);
      final response = await ApiClient(baseUrl: state.apiBaseUrl).post('/auth/register', {
        'fullName': fullName,
        'email': email,
        'password': password,
        'role': role,
      });

      final token = response['token']?.toString();
      final userJson = response['user'] as Map<String, dynamic>?;
      if (token == null || userJson == null) {
        throw Exception('Invalid register response');
      }

      final user = AppUser.fromJson(userJson);
      await _storage.saveSession(token, user);

      final selectedPatientId = user.isGuardian
          ? await _storage.getSelectedPatient(guardianUserId: user.id)
          : null;

      state = state.copyWith(
        loading: false,
        token: token,
        user: user,
        selectedPatientId: selectedPatientId,
      );

      _socketService.connect(baseUrl: state.apiBaseUrl.replaceAll('/api', ''), userId: user.id, role: user.role);
      return true;
    } on DioException catch (e) {
      state = state.copyWith(
        loading: false,
        error: e.response?.data is Map ? (e.response?.data['message']?.toString()) : e.message,
      );
      return false;
    } catch (e) {
      state = state.copyWith(loading: false, error: e.toString());
      return false;
    }
  }

  Future<bool> login({required String email, required String password}) async {
    try {
      state = state.copyWith(loading: true, clearError: true);
      final response = await ApiClient(baseUrl: state.apiBaseUrl).post('/auth/login', {
        'email': email,
        'password': password,
      });

      final token = response['token']?.toString();
      final userJson = response['user'] as Map<String, dynamic>?;
      if (token == null || userJson == null) {
        throw Exception('Invalid login response');
      }

      final user = AppUser.fromJson(userJson);
      await _storage.saveSession(token, user);

      final selectedPatientId = user.isGuardian
          ? await _storage.getSelectedPatient(guardianUserId: user.id)
          : null;

      state = state.copyWith(
        loading: false,
        token: token,
        user: user,
        selectedPatientId: selectedPatientId,
      );

      _socketService.connect(baseUrl: state.apiBaseUrl.replaceAll('/api', ''), userId: user.id, role: user.role);
      return true;
    } on DioException catch (e) {
      state = state.copyWith(
        loading: false,
        error: e.response?.data is Map ? (e.response?.data['message']?.toString()) : e.message,
      );
      return false;
    } catch (e) {
      state = state.copyWith(loading: false, error: e.toString());
      return false;
    }
  }

  Future<void> logout() async {
    _socketService.disconnect();
    await _storage.clearSession();
    state = state.copyWith(loading: false, clearSession: true, clearError: true);
  }
}

final localStorageProvider = Provider<LocalStorage>((ref) => LocalStorage());
final socketServiceProvider = Provider<SocketService>((ref) => SocketService());

final sessionProvider = StateNotifierProvider<SessionController, SessionState>(
  (ref) => SessionController(ref.read(localStorageProvider), ref.read(socketServiceProvider)),
);
