import type { FC, ReactNode } from 'react'
import LayoutEditorPanel from '../../components/layout/LayoutEditorPanel'
import type { LayoutCollection } from '../../../../types/api'
import type { LayoutCategory, LayoutDefinition } from '../../../../types/layouts'
import type { Clip } from '../../types'
import type { SaveStepState } from './saveSteps'

type LayoutReference = {
  id: string
  category: LayoutCategory | null
}

type LayoutModeViewProps = {
  tabNavigation: ReactNode
  clip: Clip | null
  layoutCollection: LayoutCollection | null
  isCollectionLoading: boolean
  selectedLayout: LayoutDefinition | null
  selectedLayoutReference: LayoutReference | null
  isLayoutLoading: boolean
  appliedLayoutId: string | null
  isSavingLayout: boolean
  isApplyingLayout: boolean
  statusMessage: string | null
  errorMessage: string | null
  onSelectLayout: (id: string, category: LayoutCategory) => void
  onCreateBlankLayout: () => void
  onLayoutChange: (layout: LayoutDefinition) => void
  onSaveLayout: (
    layout: LayoutDefinition,
    options?: { originalId?: string | null; originalCategory?: LayoutCategory | null }
  ) => Promise<LayoutDefinition>
  onImportLayout: () => Promise<void>
  onExportLayout: (id: string, category: LayoutCategory) => Promise<void>
  onApplyLayout: (layout: LayoutDefinition) => Promise<void>
  onRenderLayout: (layout: LayoutDefinition) => Promise<void>
  renderSteps: SaveStepState[]
  isRenderingLayout: boolean
  renderStatusMessage: string | null
  renderErrorMessage: string | null
}

const LayoutModeView: FC<LayoutModeViewProps> = ({
  tabNavigation,
  clip,
  layoutCollection,
  isCollectionLoading,
  selectedLayout,
  selectedLayoutReference,
  isLayoutLoading,
  appliedLayoutId,
  isSavingLayout,
  isApplyingLayout,
  statusMessage,
  errorMessage,
  onSelectLayout,
  onCreateBlankLayout,
  onLayoutChange,
  onSaveLayout,
  onImportLayout,
  onExportLayout,
  onApplyLayout,
  onRenderLayout,
  renderSteps,
  isRenderingLayout,
  renderStatusMessage,
  renderErrorMessage
}) => {
  return (
    <section className="flex w-full flex-1 flex-col gap-8 px-6 py-10 lg:px-8">
      <LayoutEditorPanel
        tabNavigation={tabNavigation}
        clip={clip}
        layoutCollection={layoutCollection}
        isCollectionLoading={isCollectionLoading}
        selectedLayout={selectedLayout}
        selectedLayoutReference={selectedLayoutReference}
        isLayoutLoading={isLayoutLoading}
        appliedLayoutId={appliedLayoutId}
        isSavingLayout={isSavingLayout}
        isApplyingLayout={isApplyingLayout}
        statusMessage={statusMessage}
        errorMessage={errorMessage}
        onSelectLayout={onSelectLayout}
        onCreateBlankLayout={onCreateBlankLayout}
        onLayoutChange={onLayoutChange}
        onSaveLayout={onSaveLayout}
        onImportLayout={onImportLayout}
        onExportLayout={onExportLayout}
        onApplyLayout={onApplyLayout}
        onRenderLayout={onRenderLayout}
        renderSteps={renderSteps}
        isRenderingLayout={isRenderingLayout}
        renderStatusMessage={renderStatusMessage}
        renderErrorMessage={renderErrorMessage}
      />
    </section>
  )
}

export default LayoutModeView
