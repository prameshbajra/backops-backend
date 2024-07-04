import { APIGatewayProxyHandler } from 'aws-lambda';

export const lambdaHandler: APIGatewayProxyHandler = async (event, _context) => {
    const body = JSON.parse(event.body || '{}');
    console.log(body);
    return {
        statusCode: 200,
        body: JSON.stringify(body),
    };
};
