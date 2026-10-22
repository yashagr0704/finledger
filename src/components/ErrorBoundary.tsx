import { Component, type ReactNode } from 'react';
import { AlertOctagon } from 'lucide-react';
import { Button } from './ui/button';
import { EmptyState } from './ui/misc';

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <EmptyState
          icon={<AlertOctagon />}
          title="Something went wrong on this page"
          description={this.state.error.message || 'An unexpected error occurred.'}
          action={
            <div className="flex gap-2">
              <Button onClick={() => this.setState({ error: null })}>Try again</Button>
              <Button variant="primary" onClick={() => (window.location.href = '/')}>
                Go to overview
              </Button>
            </div>
          }
        />
      );
    }
    return this.props.children;
  }
}
