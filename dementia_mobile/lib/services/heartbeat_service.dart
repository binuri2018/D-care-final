import 'dart:convert';

import 'package:battery_plus/battery_plus.dart';
import 'package:geolocator/geolocator.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:workmanager/workmanager.dart';

import '../core/network/api_client.dart';

const heartbeatTaskName = 'patient_heartbeat_task';

@pragma('vm:entry-point')
void heartbeatDispatcher() {
  Workmanager().executeTask((task, inputData) async {
    if (task != heartbeatTaskName) return true;

    try {
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString('token');
      final userRaw = prefs.getString('user');
      final baseUrl = prefs.getString('api_base_url') ?? 'http://localhost:4000/api';

      if (token == null || userRaw == null) return true;
      final user = jsonDecode(userRaw) as Map<String, dynamic>;
      if (user['role'] != 'patient') return true;

      final permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) {
        return true;
      }

      final position = await Geolocator.getCurrentPosition();
      final battery = Battery();
      final level = await battery.batteryLevel;

      final api = ApiClient(baseUrl: baseUrl, token: token);
      await api.post('/heartbeats', {
        'latitude': position.latitude,
        'longitude': position.longitude,
        'batteryLevel': level,
      });
    } catch (_) {
      // Ignore background failures to avoid task crash loops.
    }

    return true;
  });
}

class HeartbeatService {
  Future<void> initialize() async {
    await Workmanager().initialize(heartbeatDispatcher, isInDebugMode: true);
  }

  Future<void> start() async {
    await Workmanager().registerPeriodicTask(
      heartbeatTaskName,
      heartbeatTaskName,
      frequency: const Duration(minutes: 15),      constraints: Constraints(networkType: NetworkType.connected),
    );
  }

  Future<void> stop() async {
    await Workmanager().cancelByUniqueName(heartbeatTaskName);
  }
}

