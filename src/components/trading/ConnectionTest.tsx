import React, { useState } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { tradingApi } from '../../services/trading-api';

export const ConnectionTest: React.FC = () => {
  const [testResult, setTestResult] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);

  const testConnection = async () => {
    setIsLoading(true);
    try {
      console.log('Testing edge function connection...');
      const result = await tradingApi.testConnection();
      console.log('Test result:', result);
      setTestResult(result);
    } catch (error) {
      console.error('Test failed:', error);
      setTestResult({
        status: 'error',
        message: `Test failed: ${error}`
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Edge Function Test</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button 
          onClick={testConnection} 
          disabled={isLoading}
          className="w-full"
        >
          {isLoading ? 'Testing...' : 'Test Connection'}
        </Button>
        
        {testResult && (
          <div className="mt-4">
            <h4 className="font-medium mb-2">Result:</h4>
            <pre className="bg-gray-100 p-3 rounded text-sm overflow-auto">
              {JSON.stringify(testResult, null, 2)}
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
};