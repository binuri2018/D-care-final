import 'package:dio/dio.dart';

String getDioMessage(DioException error) {
  final data = error.response?.data;
  if (data is Map<String, dynamic> && data['message'] != null) {
    return data['message'].toString();
  }
  if (data is Map && data['message'] != null) {
    return data['message'].toString();
  }
  return error.message ?? 'Request failed';
}
