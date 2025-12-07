'use client';
import { Uploader } from "@/components/Uploader";
import { VideoList } from "@/components/VideoList";

export default function Home() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur sticky top-0 z-10">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <h1 className="text-xl font-bold tracking-tight text-primary">StreamForge</h1>
          <div className="text-sm text-muted-foreground">Video Platform</div>
        </div>
      </header>

      <main className="container mx-auto px-6 py-10 space-y-12">
        <section className="space-y-4">
          <h2 className="text-2xl font-bold tracking-tight">Upload Center</h2>
          <div className="max-w-xl">
            <Uploader />
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold tracking-tight">Your Videos</h2>
          <VideoList />
        </section>
      </main>
    </div>
  );
}
