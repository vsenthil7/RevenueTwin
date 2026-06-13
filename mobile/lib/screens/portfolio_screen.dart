import 'package:flutter/material.dart';
import '../models/leakage_case.dart';

/// CFO portfolio summary. Stateless; takes already-loaded totals so it is trivially widget-testable.
class PortfolioView extends StatelessWidget {
  final int totalRecoverableMinor;
  final int totalCases;
  final double workIQShare;
  const PortfolioView({
    super.key,
    required this.totalRecoverableMinor,
    required this.totalCases,
    required this.workIQShare,
  });
  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text('Total recoverable', style: Theme.of(context).textTheme.labelMedium),
        Text(fmtGBP(totalRecoverableMinor), key: const Key('total-recoverable'), style: Theme.of(context).textTheme.headlineMedium),
        const SizedBox(height: 16),
        Text('Open cases: ' + totalCases.toString(), key: const Key('case-count')),
        Text('Work IQ share: ' + (workIQShare * 100).round().toString() + '%', key: const Key('workiq-share')),
      ],
    );
  }
}

/// Live portfolio screen placeholder (wired to the client in main run; tests use PortfolioView).
class PortfolioScreen extends StatelessWidget {
  const PortfolioScreen({super.key});
  @override
  Widget build(BuildContext context) =>
      const Center(child: Text('Portfolio (connect API to hydrate)'));
}
