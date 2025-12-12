import ProgressBar from '../ProgressBar';

interface ProgressItemData {
  label: string;
  done: boolean;
  pending: boolean;
  value?: string;
}

interface ProgressPanelProps {
  stage: string;
  items: ProgressItemData[];
  progress: number;
}

export default function ProgressPanel({ stage, items, progress }: ProgressPanelProps) {
  return (
    <div className="admin-progress-panel">
      <div className="admin-progress-header">
        <span className="typography-inter-2">Progress</span>
        <span className="admin-progress-value">
          <span className={`admin-progress-dot ${stage === 'done' ? 'done' : 'pending'}`}></span>
          <span className="typography-inter-3">Stage: {stage}</span>
        </span>
      </div>
      <div className="admin-progress-rows text-sm">
        {items.map((item, idx) => (
          <div key={idx} className="admin-progress-row">
            <span className="admin-progress-label typography-inter-4">{item.label}</span>
            <span className="admin-progress-value">
              <span className={`admin-progress-dot ${item.done ? 'done' : item.pending ? 'pending' : 'waiting'}`}></span>
              <span className="typography-inter-3">{item.value ?? (item.done ? 'Done' : item.pending ? 'Running' : 'Waiting')}</span>
            </span>
          </div>
        ))}
      </div>
      <div className="mt-3">
        <ProgressBar percent={progress} />
      </div>
    </div>
  );
}
