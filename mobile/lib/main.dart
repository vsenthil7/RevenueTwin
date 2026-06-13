/// RevenueTwin mobile (Flutter). CFO portfolio + case triage + approval inbox over the same REST
/// API as the web console. Run: flutter run. Widget tests: flutter test (CI; needs Flutter SDK).
import 'package:flutter/material.dart';
import 'api/client.dart';
import 'inbox_state.dart';
import 'models/leakage_case.dart';
import 'screens/portfolio_screen.dart';
import 'screens/triage_screen.dart';
import 'screens/approvals_screen.dart';

void main() => runApp(const RevenueTwinApp());

class RevenueTwinApp extends StatelessWidget {
  const RevenueTwinApp({super.key});
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'RevenueTwin',
      theme: ThemeData.dark(useMaterial3: true),
      home: const HomeShell(),
    );
  }
}

class HomeShell extends StatefulWidget {
  const HomeShell({super.key});
  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _tab = 0;
  @override
  Widget build(BuildContext context) {
    final screens = [const PortfolioScreen(), const TriageScreen(), const ApprovalsScreen()];
    return Scaffold(
      body: screens[_tab],
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (i) => setState(() => _tab = i),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.dashboard), label: 'Portfolio'),
          NavigationDestination(icon: Icon(Icons.fact_check), label: 'Triage'),
          NavigationDestination(icon: Icon(Icons.inbox), label: 'Approvals'),
        ],
      ),
    );
  }
}
