import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

import { runSuite } from './src/suite';

export default function App() {
  const [report, setReport] = useState('running…');

  useEffect(() => {
    runSuite().then(
      (r) => setReport(`${r.passed}/${r.total} checks passed\n\n${JSON.stringify(r, null, 2)}`),
      (e) => setReport(`suite crashed: ${String(e)}`),
    );
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text testID="report" style={styles.report}>
        {report}
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingTop: 64 },
  report: { fontFamily: 'Menlo', fontSize: 10 },
});
