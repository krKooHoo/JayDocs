// TypeScript 의 lib.dom 에 아직 없는 File System Access API 선언. Edge · Chrome 만 쓴다.
interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite'
}

interface FileSystemHandle {
  queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>
  requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>
}

interface FileSystemFileHandle {
  move(name: string): Promise<void>
  move(directory: FileSystemDirectoryHandle, name: string): Promise<void>
}

interface DirectoryPickerOptions {
  id?: string
  mode?: 'read' | 'readwrite'
  startIn?: FileSystemHandle | 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos'
}

interface FileSystemChangeRecord {
  type: 'appeared' | 'disappeared' | 'modified' | 'moved' | 'unknown' | 'errored'
  relativePathComponents: string[]
  relativePathMovedFrom: string[] | null
  root: FileSystemHandle
}

declare class FileSystemObserver {
  constructor(callback: (records: FileSystemChangeRecord[], observer: FileSystemObserver) => void)
  observe(handle: FileSystemHandle, options?: { recursive?: boolean }): Promise<void>
  disconnect(): void
}

interface Window {
  showDirectoryPicker(options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>
}
