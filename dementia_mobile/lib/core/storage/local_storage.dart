import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../config/backend_config.dart';
import '../../models/app_user.dart';

class LocalStorage {
  static const _tokenKey = 'token';
  static const _userKey = 'user';
  static const _apiBaseKey = 'api_base_url';

  String _selectedPatientKey(String guardianUserId) => 'selected_patient_id_$guardianUserId';

  Future<void> saveSession(String token, AppUser user) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_tokenKey, token);
    await prefs.setString(_userKey, jsonEncode(user.toJson()));
  }

  Future<String?> getToken() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_tokenKey);
  }

  Future<AppUser?> getUser() async {
    final prefs = await SharedPreferences.getInstance();
    final value = prefs.getString(_userKey);
    if (value == null) return null;
    final decoded = jsonDecode(value) as Map<String, dynamic>;
    return AppUser.fromJson(decoded);
  }

  Future<void> clearSession() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_tokenKey);
    await prefs.remove(_userKey);
  }

  Future<void> saveApiBaseUrl(String url) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_apiBaseKey, url);
  }

  Future<String> getApiBaseUrl() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_apiBaseKey) ?? BackendConfig.defaultApiBase;
  }

  Future<void> saveSelectedPatient({required String guardianUserId, required String? patientId}) async {
    final prefs = await SharedPreferences.getInstance();
    final key = _selectedPatientKey(guardianUserId);

    if (patientId == null || patientId.isEmpty) {
      await prefs.remove(key);
      return;
    }

    await prefs.setString(key, patientId);
  }

  Future<String?> getSelectedPatient({required String guardianUserId}) async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_selectedPatientKey(guardianUserId));
  }
}
