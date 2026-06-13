import 'package:flutter/material.dart';
import '../models/leakage_case.dart';
import 'widgets.dart';

/// Triage list — shows the leakage queue. Stateless over a provided list for testability.
class TriageView extends StatelessWidget {
  final List<LeakageCase> cases;
  final void Function(LeakageCase)? onSelect;
  const TriageView({super.key, required this.cases, this.onSelect});
  @override
  Widget build(BuildContext context) {
    if (cases.isEmpty) {
      return const Center(child: Text('No leakage detected', key: Key('empty-queue')));
    }
    return ListView(
      children: [
        for (final c in cases) CaseTile(c: c, onTap: () => onSelect?.call(c)),
      ],
    );
  }
}

class TriageScreen extends StatelessWidget {
  const TriageScreen({super.key});
  @override
  Widget build(BuildContext context) =>
      const Center(child: Text('Triage (connect API to hydrate)'));
}
