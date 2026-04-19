import { Button } from '@/components/ui/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SubscriptionSection } from '@/components/dashboard/SubscriptionSection';

export default function SettingsPage() {
    return (
        <div className="mx-auto max-w-4xl space-y-8">
            <div>
                <h1 className="text-2xl font-bold">Settings</h1>
                <p className="text-muted-foreground">
                    Manage your account and subscription
                </p>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Profile</CardTitle>
                    <CardDescription>
                        Update your personal information
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                            <Label htmlFor="name">Name</Label>
                            <Input id="name" defaultValue="John Doe" />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="email">Email</Label>
                            <Input
                                id="email"
                                type="email"
                                defaultValue="john@example.com"
                            />
                        </div>
                    </div>
                    <Button>Save changes</Button>
                </CardContent>
            </Card>

            <SubscriptionSection />

            <Card>
                <CardHeader>
                    <CardTitle>Password</CardTitle>
                    <CardDescription>Change your password</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="current-password">
                            Current password
                        </Label>
                        <Input id="current-password" type="password" />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="new-password">New password</Label>
                        <Input id="new-password" type="password" />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="confirm-password">
                            Confirm new password
                        </Label>
                        <Input id="confirm-password" type="password" />
                    </div>
                    <Button>Update password</Button>
                </CardContent>
            </Card>

            <Card className="border-destructive/50">
                <CardHeader>
                    <CardTitle className="text-destructive">
                        Danger Zone
                    </CardTitle>
                    <CardDescription>
                        Irreversible and destructive actions
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Button variant="destructive">Delete account</Button>
                </CardContent>
            </Card>
        </div>
    );
}
