/**
 * キーごとに同時実行を1つへ制限するジョブディスパッチャー。
 * 実行中と同じキーが再度追加された場合は、現在の実行後にもう一度処理する。
 * 異なるキーは互いを待たずに実行できる。
 */
export function createKeyedJobDispatcher(worker) {
  const activeJobs = new Map();

  function dispatch(jobId) {
    const active = activeJobs.get(jobId);
    if (active) {
      active.rerunRequested = true;
      return active.promise;
    }

    const state = { rerunRequested: false, promise: null };
    state.promise = Promise.resolve()
      .then(async () => {
        do {
          state.rerunRequested = false;
          await worker(jobId);
        } while (state.rerunRequested);
      })
      .finally(() => {
        activeJobs.delete(jobId);
      });
    activeJobs.set(jobId, state);
    return state.promise;
  }

  return { dispatch };
}
