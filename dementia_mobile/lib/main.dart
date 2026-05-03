import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app.dart';
import 'services/heartbeat_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await HeartbeatService().initialize();
  runApp(const ProviderScope(child: DementiaApp()));
}
