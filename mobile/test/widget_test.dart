import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:revenuetwin_mobile/models/leakage_case.dart';
import 'package:revenuetwin_mobile/screens/portfolio_screen.dart';
import 'package:revenuetwin_mobile/screens/triage_screen.dart';
import 'package:revenuetwin_mobile/screens/approvals_screen.dart';

LeakageCase _case(String id, int net, {bool wq = false, String status = 'open'}) => LeakageCase(
  id: id, customer: 'Cust-' + id, type: 'intent', grossDetectedMinor: net,
  netRecoverableMinor: net, confidence: 0.9, detectedViaWorkIQ: wq, status: status,
);

void main() {
  testWidgets('PortfolioView shows totals', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: PortfolioView(
      totalRecoverableMinor: 184000, totalCases: 3, workIQShare: 0.65,
    )));
    expect(find.byKey(const Key('total-recoverable')), findsOneWidget);
    expect(find.text('GBP 1,840.00'), findsOneWidget);
    expect(find.text('Work IQ share: 65%'), findsOneWidget);
  });

  testWidgets('TriageView lists cases and fires onSelect', (tester) async {
    LeakageCase? picked;
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: TriageView(
      cases: [_case('a', 90000, wq: true), _case('b', 50000)],
      onSelect: (c) => picked = c,
    ))));
    expect(find.byKey(const Key('case-a')), findsOneWidget);
    expect(find.text('WORK IQ'), findsOneWidget);
    await tester.tap(find.byKey(const Key('case-a')));
    expect(picked!.id, 'a');
  });

  testWidgets('TriageView shows empty state', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: Scaffold(body: TriageView(cases: []))));
    expect(find.byKey(const Key('empty-queue')), findsOneWidget);
  });

  testWidgets('ApprovalsView shows recovered total and fires approve/reject', (tester) async {
    final approved = <String>[];
    final rejected = <String>[];
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: ApprovalsView(
      pending: [_case('a', 90000), _case('b', 50000)],
      recoveredMinor: 120000,
      onApprove: (c) => approved.add(c.id),
      onReject: (c) => rejected.add(c.id),
    ))));
    expect(find.text('Recovered: GBP 1,200.00'), findsOneWidget);
    await tester.tap(find.byKey(const Key('approve-a')));
    await tester.tap(find.byKey(const Key('reject-b')));
    expect(approved, ['a']);
    expect(rejected, ['b']);
  });
}
