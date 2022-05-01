import { sleep } from './utils';
import { error } from '@infinityxyz/lib/utils';

const MAX_SIZE = 500;

interface Batch {
  batch: FirebaseFirestore.WriteBatch;
  size: number;
}

export default class FirestoreBatchHandler {
  private currentBatch: Batch;
  private db: FirebaseFirestore.Firestore;

  constructor(firestore: FirebaseFirestore.Firestore) {
    this.currentBatch = this.newBatch();
    this.db = firestore;
  }

  get size(): number {
    return this.currentBatch.size;
  }

  add(
    doc: FirebaseFirestore.DocumentReference,
    object: Partial<FirebaseFirestore.DocumentData>,
    options: FirebaseFirestore.SetOptions
  ): void {
    if (this.currentBatch.size >= MAX_SIZE) {
      this.flush().catch((err) => {
        error(err);
        throw err;
      });
    }

    this.currentBatch.batch.set(doc, object, options);
    this.currentBatch.size += 1;
  }

  async flush(): Promise<void> {
    if (this.currentBatch.size > 0) {
      const maxAttempts = 3;
      let attempt = 0;
      const batch = this.currentBatch.batch;
      this.currentBatch = this.newBatch();
      for (;;) {
        attempt += 1;
        try {
          await batch.commit();
          return;
        } catch (err: any) {
          // Logger.error('Failed to commit batch', err);
          if (attempt > maxAttempts) {
            error(`Failed to commit batch`);
            throw err;
          }
          await sleep(1000); // Firebase has a limit of 1 write per doc per second
        }
      }
    }
  }

  private newBatch(): Batch {
    return {
      batch: this.db.batch(),
      size: 0
    };
  }
}
