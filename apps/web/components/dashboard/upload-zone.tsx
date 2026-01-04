"use client"

import type React from "react"
import { useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Upload, X, FileIcon, CheckCircle, Loader2 } from "lucide-react"
import { cn } from "@/lib/cn"

interface UploadFile {
  id: string
  file: File
  progress: number
  status: "pending" | "uploading" | "complete" | "error"
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes"
  const k = 1024
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
}

export function UploadZone() {
  const [files, setFiles] = useState<UploadFile[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const [isUploading, setIsUploading] = useState(false)

  const addFiles = useCallback((newFiles: FileList | null) => {
    if (!newFiles) return
    const uploadFiles: UploadFile[] = Array.from(newFiles).map((file) => ({
      id: Math.random().toString(36).substring(7),
      file,
      progress: 0,
      status: "pending" as const,
    }))
    setFiles((prev) => [...prev, ...uploadFiles])
  }, [])

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id))
  }

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragOver(false)
      addFiles(e.dataTransfer.files)
    },
    [addFiles],
  )

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }

  const handleDragLeave = () => {
    setIsDragOver(false)
  }

  const simulateUpload = async () => {
    setIsUploading(true)
    for (const file of files) {
      if (file.status !== "pending") continue
      setFiles((prev) => prev.map((f) => (f.id === file.id ? { ...f, status: "uploading" as const } : f)))
      // Simulate upload progress
      for (let progress = 0; progress <= 100; progress += 10) {
        await new Promise((resolve) => setTimeout(resolve, 100))
        setFiles((prev) => prev.map((f) => (f.id === file.id ? { ...f, progress } : f)))
      }
      setFiles((prev) => prev.map((f) => (f.id === file.id ? { ...f, status: "complete" as const } : f)))
    }
    setIsUploading(false)
  }

  const totalSize = files.reduce((acc, f) => acc + f.file.size, 0)
  const estimatedCost = (totalSize / (1024 * 1024 * 1024)) * 0.01 // $0.01 per GB per month
  const pendingFiles = files.filter((f) => f.status === "pending")
  const hasCompletedFiles = files.some((f) => f.status === "complete")

  return (
    <div className="space-y-6">
      <Card
        className={cn(
          "border-2 border-dashed transition-colors",
          isDragOver ? "border-primary bg-primary/5" : "border-border",
        )}
      >
        <CardContent className="p-0">
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            className="flex flex-col items-center justify-center px-6 py-16"
          >
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <Upload className="h-8 w-8 text-primary" />
            </div>
            <h3 className="mb-2 text-lg font-semibold">Drop files here to upload</h3>
            <p className="mb-4 text-sm text-muted-foreground">or click to browse your computer</p>
            <label>
              <input
                type="file"
                multiple
                className="hidden"
                onChange={(e) => addFiles(e.target.files)}
                disabled={isUploading}
              />
              <Button variant="outline" disabled={isUploading} render={<span />}>
                Browse files
              </Button>
            </label>
          </div>
        </CardContent>
      </Card>

      {files.length > 0 && (
        <Card>
          <CardContent className="p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-semibold">Selected Files ({files.length})</h3>
              {!isUploading && (
                <Button variant="ghost" size="sm" onClick={() => setFiles([])}>
                  Clear all
                </Button>
              )}
            </div>
            <div className="space-y-3">
              {files.map((file) => (
                <div key={file.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                    {file.status === "complete" ? (
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    ) : file.status === "uploading" ? (
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    ) : (
                      <FileIcon className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="truncate font-medium">{file.file.name}</p>
                    <p className="text-sm text-muted-foreground">{formatBytes(file.file.size)}</p>
                    {file.status === "uploading" && <Progress value={file.progress} className="mt-2 h-1" />}
                  </div>
                  {file.status === "pending" && !isUploading && (
                    <Button variant="ghost" size="icon" onClick={() => removeFile(file.id)}>
                      <X className="h-4 w-4" />
                      <span className="sr-only">Remove</span>
                    </Button>
                  )}
                  {file.status === "complete" && <span className="text-xs font-medium text-green-500">Uploaded</span>}
                </div>
              ))}
            </div>
            <div className="mt-6 flex flex-col gap-4 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <p className="text-sm">
                  <span className="text-muted-foreground">Total size:</span>{" "}
                  <span className="font-medium">{formatBytes(totalSize)}</span>
                </p>
                <p className="text-sm">
                  <span className="text-muted-foreground">Est. monthly cost:</span>{" "}
                  <span className="font-medium">${estimatedCost.toFixed(2)}</span>
                </p>
              </div>
              {pendingFiles.length > 0 && (
                <Button onClick={simulateUpload} disabled={isUploading}>
                  {isUploading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Upload className="mr-2 h-4 w-4" />
                      Upload {pendingFiles.length} {pendingFiles.length === 1 ? "file" : "files"}
                    </>
                  )}
                </Button>
              )}
              {hasCompletedFiles && pendingFiles.length === 0 && !isUploading && (
                <p className="text-sm font-medium text-green-500">All files uploaded successfully!</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
