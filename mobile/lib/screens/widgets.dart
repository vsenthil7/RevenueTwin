import 'package:flutter/material.dart';
import '../models/leakage_case.dart';

/// A reusable leakage-case tile used across triage and approvals.
class CaseTile extends StatelessWidget {
  final LeakageCase c;
  final VoidCallback? onTap;
  const CaseTile({super.key, required this.c, this.onTap});
  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        onTap: onTap,
        key: Key('case-' + c.id),
        title: Text('''\${c.customer}  ·  \${fmtGBP(c.netRecoverableMinor)}'''),
        subtitle: Text('''\${c.type}  ·  confidence \${(c.confidence * 100).round()}%'''),
        trailing: c.detectedViaWorkIQ
            ? const Chip(label: Text('WORK IQ'))
            : null,
      ),
    );
  }
}
