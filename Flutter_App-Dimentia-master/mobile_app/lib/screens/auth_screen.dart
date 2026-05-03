import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/theme/app_theme.dart';
import '../core/widgets/glass_card.dart';
import '../providers/session_provider.dart';

class AuthScreen extends ConsumerStatefulWidget {
  const AuthScreen({super.key});

  @override
  ConsumerState<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends ConsumerState<AuthScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();

  bool _isLogin = true;
  bool _passwordVisible = false;
  String _role = 'guardian';

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;

    final session = ref.read(sessionProvider.notifier);
    if (_isLogin) {
      await session.login(email: _emailController.text.trim(), password: _passwordController.text.trim());
    } else {
      await session.register(
        fullName: _nameController.text.trim(),
        email: _emailController.text.trim(),
        password: _passwordController.text.trim(),
        role: _role,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(sessionProvider);

    return Scaffold(
      backgroundColor: Colors.transparent,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(22, 18, 22, 26),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 390),
              child: Column(
                children: [
                  const SizedBox(height: 8),
                  Text(
                    _isLogin ? 'WELCOME BACK' : 'CREATE YOUR ACCOUNT',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      color: Colors.white,
                      letterSpacing: 1.0,
                      fontSize: 28,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    _isLogin
                        ? 'Sign in to continue guardian and patient care tracking'
                        : 'Register securely for guardian or patient access',
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: Color(0xFFE8F6FF),
                      fontSize: 13,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  const SizedBox(height: 18),
                  _buildAuthSheet(context, state),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildAuthSheet(BuildContext context, SessionState state) {
    return GlassCard(
      padding: EdgeInsets.zero,
      radius: 30,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(30),
        child: Column(
          children: [
            SizedBox(
              height: 102,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  const DecoratedBox(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                        colors: [Color(0xFF26AAEE), Color(0xFF0B87DE)],
                      ),
                    ),
                  ),
                  Positioned.fill(
                    child: ClipPath(
                      clipper: _TopWaveClipper(),
                      child: Container(color: Colors.white.withValues(alpha: 0.18)),
                    ),
                  ),
                  Align(
                    alignment: Alignment.center,
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.16),
                        borderRadius: BorderRadius.circular(999),
                        border: Border.all(color: Colors.white.withValues(alpha: 0.32)),
                      ),
                      child: const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.shield_outlined, color: Colors.white, size: 16),
                          SizedBox(width: 6),
                          Text(
                            'SECURE MEDICAL ACCESS',
                            style: TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.w700,
                              fontSize: 10,
                              letterSpacing: 0.6,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 18, 20, 20),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton(
                            onPressed: state.loading ? null : () => setState(() => _isLogin = true),
                            style: OutlinedButton.styleFrom(
                              minimumSize: const Size.fromHeight(41),
                              backgroundColor: _isLogin ? const Color(0xFFE9F5FF) : Colors.white,
                              side: BorderSide(
                                color: _isLogin ? AppColors.primary : AppColors.outline,
                              ),
                              foregroundColor: _isLogin ? AppColors.primaryDark : AppColors.mutedText,
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                              textStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
                            ),
                            child: const Text('SIGN IN'),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: OutlinedButton(
                            onPressed: state.loading ? null : () => setState(() => _isLogin = false),
                            style: OutlinedButton.styleFrom(
                              minimumSize: const Size.fromHeight(41),
                              backgroundColor: !_isLogin ? const Color(0xFFE9F5FF) : Colors.white,
                              side: BorderSide(
                                color: !_isLogin ? AppColors.primary : AppColors.outline,
                              ),
                              foregroundColor: !_isLogin ? AppColors.primaryDark : AppColors.mutedText,
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
                              textStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
                            ),
                            child: const Text('SIGN UP'),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 14),
                    AnimatedSwitcher(
                      duration: const Duration(milliseconds: 250),
                      child: _isLogin
                          ? const SizedBox.shrink(key: ValueKey('login-fields'))
                          : Column(
                              key: const ValueKey('register-fields'),
                              children: [
                                TextFormField(
                                  controller: _nameController,
                                  textInputAction: TextInputAction.next,
                                  decoration: const InputDecoration(
                                    labelText: 'Full Name',
                                    prefixIcon: Icon(Icons.badge_outlined),
                                  ),
                                  validator: (value) =>
                                      !_isLogin && (value == null || value.trim().isEmpty) ? 'Enter your name' : null,
                                ),
                                const SizedBox(height: 12),
                              ],
                            ),
                    ),
                    TextFormField(
                      controller: _emailController,
                      keyboardType: TextInputType.emailAddress,
                      textInputAction: TextInputAction.next,
                      decoration: const InputDecoration(
                        labelText: 'Phone or Email',
                        prefixIcon: Icon(Icons.alternate_email_rounded),
                      ),
                      validator: (value) => (value == null || !value.contains('@')) ? 'Enter a valid email' : null,
                    ),
                    const SizedBox(height: 12),
                    TextFormField(
                      controller: _passwordController,
                      obscureText: !_passwordVisible,
                      textInputAction: TextInputAction.done,
                      onFieldSubmitted: (_) => _submit(),
                      decoration: InputDecoration(
                        labelText: 'Password',
                        prefixIcon: const Icon(Icons.lock_outline_rounded),
                        suffixIcon: IconButton(
                          onPressed: () => setState(() => _passwordVisible = !_passwordVisible),
                          icon: Icon(_passwordVisible ? Icons.visibility_off_outlined : Icons.visibility_outlined),
                        ),
                      ),
                      validator: (value) =>
                          (value == null || value.length < 6) ? 'Password must be at least 6 characters' : null,
                    ),
                    if (!_isLogin) ...[
                      const SizedBox(height: 12),
                      Row(
                        children: [
                          Expanded(
                            child: ChoiceChip(
                              label: const Text('Guardian'),
                              selected: _role == 'guardian',
                              onSelected: state.loading ? null : (_) => setState(() => _role = 'guardian'),
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: ChoiceChip(
                              label: const Text('Patient'),
                              selected: _role == 'patient',
                              onSelected: state.loading ? null : (_) => setState(() => _role = 'patient'),
                            ),
                          ),
                        ],
                      ),
                    ],
                    if (state.error != null) ...[
                      const SizedBox(height: 12),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                        decoration: BoxDecoration(
                          color: AppColors.error.withValues(alpha: 0.1),
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Text(
                          state.error!,
                          style: const TextStyle(color: AppColors.error, fontWeight: FontWeight.w600),
                        ),
                      ),
                    ],
                    const SizedBox(height: 16),
                    FilledButton(
                      style: FilledButton.styleFrom(
                        minimumSize: const Size.fromHeight(48),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(22)),
                      ),
                      onPressed: state.loading ? null : _submit,
                      child: state.loading
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                valueColor: AlwaysStoppedAnimation(Colors.white),
                              ),
                            )
                          : Text(_isLogin ? 'SIGN IN' : 'SIGN UP'),
                    ),
                    const SizedBox(height: 8),
                    TextButton(
                      onPressed: state.loading ? null : () => setState(() => _isLogin = !_isLogin),
                      child: Text(
                        _isLogin ? 'Don\'t have account? Sign up' : 'Already have account? Sign in',
                        style: const TextStyle(color: AppColors.primaryDark, fontWeight: FontWeight.w600, fontSize: 12.5),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _TopWaveClipper extends CustomClipper<Path> {
  @override
  Path getClip(Size size) {
    final path = Path();
    path.lineTo(0, size.height * 0.70);
    path.quadraticBezierTo(
      size.width * 0.18,
      size.height * 0.34,
      size.width * 0.48,
      size.height * 0.50,
    );
    path.quadraticBezierTo(
      size.width * 0.76,
      size.height * 0.64,
      size.width,
      size.height * 0.40,
    );
    path.lineTo(size.width, 0);
    path.close();
    return path;
  }

  @override
  bool shouldReclip(covariant CustomClipper<Path> oldClipper) => false;
}
