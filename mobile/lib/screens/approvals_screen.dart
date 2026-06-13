import 'package:flutter/material.dart';
import '../models/leakage_case.dart';

/// Approval inbox view. Stateless over the pending list + running recovered total; the parent
/// wires the approve/reject callbacks to InboxState so this stays widget-testable.
class ApprovalsView extends StatelessWidget {
  final List<LeakageCase> pending;
  final int recoveredMinor;
  final void Function(LeakageCase)? onApprove;
  final void Function(LeakageCase)? onReject;
  const ApprovalsView({
    super.key,
    required this.pending,
    required this.recoveredMinor,
    this.onApprove,
    this.onReject,
  });
  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(16),
          child: Text('Recovered: ' + fmtGBP(recoveredMinor), key: const Key('recovered-total')),
        ),
        Expanded(
          child: ListView(
            children: [
              for (final c in pending)
                ListTile(
                  key: Key('approve-row-' + c.id),
                  title: Text(c.customer),
                  subtitle: Text(fmtGBP(c.netRecoverableMinor)),
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      IconButton(
                        key: Key('approve-' + c.id),
                        icon: const Icon(Icons.check),
                        onPressed: () => onApprove?.call(c),
                      ),
                      IconButton(
                        key: Key('reject-' + c.id),
                        icon: const Icon(Icons.close),
                        onPressed: () => onReject?.call(c),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

class ApprovalsScreen extends StatelessWidget {
  const ApprovalsScreen({super.key});
  @override
  Widget build(BuildContext context) =>
      const Center(child: Text('Approvals (connect API to hydrate)'));
}
