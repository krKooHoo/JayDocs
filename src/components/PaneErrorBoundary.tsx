import { Component, type ReactNode } from 'react'

/**
 * 창 안쪽의 렌더 오류를 여기서 잡는다. 바깥 창(GridPane 등)은 그대로 남아 문서를 붙잡고 있으므로
 * flexlayout 의 오류 화면 → Retry 처럼 창이 내려가며(store.release) 저장 안 한 편집을 잃는 일이 없다.
 */
export class PaneErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error(error)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="banner is-error">
        화면을 그리다 오류가 났습니다: {this.state.error.message} — 편집 내용은 그대로 있고 저장할 수 있습니다.
        <button onClick={() => this.setState({ error: null })}>다시 그리기</button>
      </div>
    )
  }
}
