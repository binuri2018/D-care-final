import 'package:flutter/material.dart';

Route<T> buildDetailRoute<T>(Widget page) {
  return MaterialPageRoute<T>(builder: (_) => page);
}

Future<T?> pushDetailPage<T>(BuildContext context, Widget page) {
  return Navigator.of(context).push<T>(buildDetailRoute<T>(page));
}

