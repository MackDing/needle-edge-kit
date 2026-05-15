// Minimal React Native shell. Fill in your UI; the important parts are:
//   1) loadModel() once on app start
//   2) call generate() on user input
//   3) routeToolCalls() to dispatch to native modules

import React, { useEffect, useState } from 'react';
import { SafeAreaView, View, Text, TextInput, Button, StyleSheet, Alert, ScrollView } from 'react-native';
import { loadModel, generate } from './needle';
import { routeToolCalls, ToolCall, ToolResult } from './router';
import toolsSchema from '../../tools/example_tools.json';

export default function App() {
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState('turn off all lights and play jazz');
  const [calls, setCalls] = useState<ToolCall[]>([]);
  const [results, setResults] = useState<ToolResult[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadModel().then(() => setReady(true))
               .catch((e) => Alert.alert('Model load failed', e.message));
  }, []);

  const onGo = async () => {
    if (!ready) return;
    setBusy(true); setCalls([]); setResults([]);
    try {
      const c = await generate(query, toolsSchema);
      setCalls(c);
      const r = await routeToolCalls(c, {
        confirm: (call) => new Promise((resolve) => {
          Alert.alert(
            'Confirm?',
            `Run ${call.name}(${JSON.stringify(call.arguments)})?`,
            [
              { text: 'Cancel', onPress: () => resolve(false) },
              { text: 'OK',     onPress: () => resolve(true) },
            ],
          );
        }),
      });
      setResults(r);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <Text style={styles.title}>Needle Edge</Text>
      <Text style={styles.sub}>{ready ? 'model ready · offline' : 'loading…'}</Text>
      <TextInput style={styles.input} value={query} onChangeText={setQuery} multiline />
      <Button title={busy ? 'thinking…' : 'Run'} onPress={onGo} disabled={!ready || busy} />
      <ScrollView style={styles.out}>
        <Text style={styles.label}>Tool calls</Text>
        <Text style={styles.code}>{JSON.stringify(calls, null, 2)}</Text>
        <Text style={styles.label}>Results</Text>
        <Text style={styles.code}>{JSON.stringify(results, null, 2)}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root:  { flex: 1, backgroundColor: '#0d0f12', padding: 20 },
  title: { color: '#e8eaed', fontSize: 22, fontWeight: '600' },
  sub:   { color: '#8b9098', marginBottom: 16, fontSize: 12 },
  input: { backgroundColor: '#1a1d21', color: '#e8eaed', borderRadius: 6,
           padding: 10, minHeight: 60, marginBottom: 10, fontSize: 14 },
  out:   { marginTop: 16, flex: 1 },
  label: { color: '#8b9098', fontSize: 11, marginTop: 12, marginBottom: 4 },
  code:  { color: '#e8eaed', backgroundColor: '#15171b',
           padding: 10, borderRadius: 6, fontFamily: 'Menlo', fontSize: 12 },
});
