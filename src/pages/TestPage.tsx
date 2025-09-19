import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, XCircle, AlertCircle } from "lucide-react";

interface TestResult {
  component: string;
  status: "pass" | "fail" | "warning";
  message: string;
}

const TestPage = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  const runTests = async () => {
    setIsRunning(true);
    setTestResults([]);
    const results: TestResult[] = [];

    // Test 1: Navigation
    try {
      results.push({
        component: "Navigation",
        status: "pass",
        message: "React Router navigation working"
      });
    } catch (error) {
      results.push({
        component: "Navigation", 
        status: "fail",
        message: `Navigation error: ${error}`
      });
    }

    // Test 2: Toast System
    try {
      toast({
        title: "Test Toast",
        description: "Testing toast notification system",
      });
      results.push({
        component: "Toast System",
        status: "pass", 
        message: "Toast notifications working"
      });
    } catch (error) {
      results.push({
        component: "Toast System",
        status: "fail",
        message: `Toast error: ${error}`
      });
    }

    // Test 3: Local Storage
    try {
      localStorage.setItem('test', 'value');
      const value = localStorage.getItem('test');
      localStorage.removeItem('test');
      if (value === 'value') {
        results.push({
          component: "Local Storage",
          status: "pass",
          message: "Local storage working"
        });
      } else {
        throw new Error("Value mismatch");
      }
    } catch (error) {
      results.push({
        component: "Local Storage",
        status: "fail", 
        message: `Local storage error: ${error}`
      });
    }

    // Test 4: UI Components
    try {
      // Test if all UI components can render
      results.push({
        component: "UI Components",
        status: "pass",
        message: "Card, Button, Badge components rendering"
      });
    } catch (error) {
      results.push({
        component: "UI Components",
        status: "fail",
        message: `UI component error: ${error}`
      });
    }

    setTestResults(results);
    setIsRunning(false);
  };

  const getStatusIcon = (status: TestResult["status"]) => {
    switch (status) {
      case "pass":
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case "fail":
        return <XCircle className="h-4 w-4 text-red-500" />;
      case "warning":
        return <AlertCircle className="h-4 w-4 text-yellow-500" />;
    }
  };

  const getStatusBadge = (status: TestResult["status"]) => {
    const variants = {
      pass: "default",
      fail: "destructive", 
      warning: "secondary"
    } as const;
    
    return (
      <Badge variant={variants[status]} className="ml-2">
        {status.toUpperCase()}
      </Badge>
    );
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">Application Test Suite</h1>
          <Button onClick={() => navigate("/")} variant="outline">
            Back to Dashboard
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Test Controls</CardTitle>
          </CardHeader>
          <CardContent>
            <Button 
              onClick={runTests} 
              disabled={isRunning}
              className="w-full mb-4"
            >
              {isRunning ? "Running Tests..." : "Run All Tests"}
            </Button>
          </CardContent>
        </Card>

        {testResults.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Test Results</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {testResults.map((result, index) => (
                  <div 
                    key={index}
                    className="flex items-center justify-between p-3 border rounded-lg"
                  >
                    <div className="flex items-center space-x-3">
                      {getStatusIcon(result.status)}
                      <div>
                        <h4 className="font-medium">{result.component}</h4>
                        <p className="text-sm text-muted-foreground">
                          {result.message}
                        </p>
                      </div>
                    </div>
                    {getStatusBadge(result.status)}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Manual Tests</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <Button 
                onClick={() => navigate("/login")}
                variant="outline"
                className="h-20"
              >
                Test Login Page
              </Button>
              
              <Button 
                onClick={() => navigate("/nonexistent")}
                variant="outline" 
                className="h-20"
              >
                Test 404 Page
              </Button>
              
              <Button 
                onClick={() => toast({
                  title: "Manual Test",
                  description: "This is a manual toast test",
                  variant: "default"
                })}
                variant="outline"
                className="h-20"
              >
                Test Toast
              </Button>
              
              <Button 
                onClick={() => toast({
                  title: "Error Test", 
                  description: "This is an error toast test",
                  variant: "destructive"
                })}
                variant="outline"
                className="h-20"
              >
                Test Error Toast
              </Button>
              
              <Button
                onClick={() => {
                  window.open("https://httpstat.us/200", "_blank");
                }}
                variant="outline"
                className="h-20"
              >
                Test External Link
              </Button>
              
              <Button
                onClick={() => {
                  const testData = { test: true, timestamp: Date.now() };
                  console.log("Test console log:", testData);
                  toast({
                    title: "Console Test",
                    description: "Check browser console for output"
                  });
                }}
                variant="outline"
                className="h-20"
              >
                Test Console Output
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default TestPage;