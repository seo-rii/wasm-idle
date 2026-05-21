export default class MultiprocessManager {
    private maxProcesses: number;
    private runningProcesses: number;
    private taskQueue: (() => Promise<any>)[];
  
    constructor(maxProcesses: number) {
      this.maxProcesses = maxProcesses;
      this.runningProcesses = 0;
      this.taskQueue = [];
    }
  
    private runNext(): void {
      if (this.runningProcesses >= this.maxProcesses || this.taskQueue.length === 0) {
        return;
      }
  
      const task = this.taskQueue.shift()!;
      this.runningProcesses++;
  
      task()
        .finally(() => {
          this.runningProcesses--;
          this.runNext();
        });
  
      this.runNext();
    }
  
    public run<T>(task: () => Promise<T>): Promise<T> {
        return new Promise((resolve, reject) => {
          this.taskQueue.push(async () => {
            try {
              const result = await task();
              resolve(result);
              return result;
            } catch (error) {
              reject(error);
              throw error;
            }
        });
        this.runNext();
      });
    }

    public join() {
        return new Promise<void>((resolve) => {
          const interval = setInterval(() => {
            if (this.runningProcesses === 0 && this.taskQueue.length === 0) {
              clearInterval(interval);
              resolve();
            }
          }, 100);
        });
    }
  }