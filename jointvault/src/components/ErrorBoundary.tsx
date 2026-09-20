/*
 * Render sırasında çöken bileşenleri yakalar.
 *
 * Eskiden hiçbir sınır yoktu: bir bileşen render'da hata verirse React tüm
 * ağacı boşaltıyor ve kullanıcı bomboş bir pencereyle kalıyordu. Sınır,
 * çökmeyi görünür ve kurtarılabilir hâle getirir.
 *
 * NoticeProvider'ın İÇİNDE durur (App kökünde sarılır); böylece hata ekranı
 * bildirim sistemini ve dosya açma sarmalayıcısını kullanabilir.
 */
import React from 'react';
import { CrashScreen } from '@/components/CrashScreen';
import { describeError } from '@/lib/errors';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: unknown;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    /* Geliştirici izi konsolda kalır; kullanıcı yukarıdaki ekranı görür. */
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  private readonly retry = (): void => {
    this.setState({ error: null });
  };

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <CrashScreen
          title="Beklenmeyen bir hata oluştu"
          message="Arayüzün bir parçası çizilemedi. Yeniden denemek genellikle yeterlidir; sorun sürerse ayrıntıya bak."
          detail={describeError(this.state.error)}
          onRetry={this.retry}
        />
      );
    }
    return this.props.children;
  }
}
