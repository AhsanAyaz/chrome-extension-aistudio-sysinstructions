export default [
  {
    files: ['src/**/*.{ts,js}'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'DIST-04: no third-party network calls.' },
        { name: 'XMLHttpRequest', message: 'DIST-04: no third-party network calls.' },
        { name: 'WebSocket', message: 'DIST-04: no third-party network calls.' },
        { name: 'EventSource', message: 'DIST-04: no third-party network calls.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'navigator', property: 'sendBeacon', message: 'DIST-04: no third-party network calls.' },
        { object: 'window', property: 'fetch', message: 'DIST-04: no third-party network calls.' },
      ],
    },
  },
];
