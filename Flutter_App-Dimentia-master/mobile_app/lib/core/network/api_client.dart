import 'package:dio/dio.dart';

class ApiClient {
  ApiClient({required String baseUrl, String? token})
      : _dio = Dio(
          BaseOptions(
            baseUrl: baseUrl,
            connectTimeout: const Duration(seconds: 20),
            receiveTimeout: const Duration(seconds: 30),
            headers: token != null ? {'Authorization': 'Bearer $token'} : null,
          ),
        );

  final Dio _dio;

  Dio get raw => _dio;

  Future<Map<String, dynamic>> post(String path, Map<String, dynamic> data) async {
    final response = await _dio.post(path, data: data);
    return Map<String, dynamic>.from(response.data as Map);
  }

  Future<Map<String, dynamic>> get(String path, {Map<String, dynamic>? query}) async {
    final response = await _dio.get(path, queryParameters: query);
    return Map<String, dynamic>.from(response.data as Map);
  }

  Future<List<dynamic>> getList(String path, {Map<String, dynamic>? query}) async {
    final response = await _dio.get(path, queryParameters: query);
    return List<dynamic>.from(response.data as List);
  }
}
