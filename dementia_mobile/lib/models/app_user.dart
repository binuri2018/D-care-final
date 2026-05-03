class AppUser {
  const AppUser({
    required this.id,
    required this.fullName,
    required this.email,
    required this.role,
  });

  final String id;
  final String fullName;
  final String email;
  final String role;

  bool get isGuardian => role == 'guardian';
  bool get isPatient => role == 'patient';

  factory AppUser.fromJson(Map<String, dynamic> json) => AppUser(
        id: json['id']?.toString() ?? json['_id']?.toString() ?? '',
        fullName: json['fullName']?.toString() ?? '',
        email: json['email']?.toString() ?? '',
        role: json['role']?.toString() ?? 'patient',
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'fullName': fullName,
        'email': email,
        'role': role,
      };
}
