import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveMinutesGenerationResults } from '../src/services/minutesService.js';

test('quality evaluation failure does not discard generated minutes', () => {
  const result = resolveMinutesGenerationResults(
    { status: 'fulfilled', value: { summary: 'generated' } },
    { status: 'rejected', reason: new Error('quality timeout') }
  );

  assert.deepEqual(result.generatedContent, { summary: 'generated' });
  assert.equal(result.lessonQualityEvaluation, null);
  assert.equal(result.qualityEvaluationError, 'quality timeout');
});

test('minutes generation failure is still fatal', () => {
  const error = new Error('minutes timeout');
  assert.throws(
    () => resolveMinutesGenerationResults(
      { status: 'rejected', reason: error },
      { status: 'fulfilled', value: { version: 2 } }
    ),
    error
  );
});
