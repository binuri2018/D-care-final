import 'package:socket_io_client/socket_io_client.dart' as io;

class SocketService {
  io.Socket? _socket;

  void connect({required String baseUrl, required String userId, required String role}) {
    _socket?.dispose();

    _socket = io.io(
      baseUrl,
      io.OptionBuilder()
          .setTransports(['websocket'])
          .setQuery({'userId': userId, 'role': role})
          .enableAutoConnect()
          .build(),
    );

    _socket?.connect();
  }

  void listenAlerts(void Function(dynamic data) onAlert) {
    _socket?.on('alert:new', onAlert);
  }

  void disconnect() {
    _socket?.dispose();
    _socket = null;
  }
}
