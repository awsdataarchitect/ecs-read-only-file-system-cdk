import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as logs from 'aws-cdk-lib/aws-logs';
import { DockerImageAsset } from 'aws-cdk-lib/aws-ecr-assets';
import { Aspects } from 'aws-cdk-lib';


export class ecsStack extends cdk.Stack {

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create a VPC with public subnets only and 2 max availability zones
    const vpc = new ec2.Vpc(this, 'MyVpc', {
      maxAzs: 2,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'public-subnet',
          subnetType: ec2.SubnetType.PUBLIC,
        },
      ],
    });

    // Create an ECS Cluster named "my-ecs-cluster"
    const cluster = new ecs.Cluster(this, 'MyEcsCluster', {
      vpc,
      clusterName: 'my-ecs-cluster',
    });

    // Build and push Docker image to ECR
    const appImageAsset = new DockerImageAsset(this, 'MyAppImage', {
      directory: './lib/docker',
    });

    // Create a new Fargate service with the image from ECR and specify the service name
    const appService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'MyFargateService', {
      cluster,
      serviceName: 'ecs-service',
      taskImageOptions: {
        image: ecs.ContainerImage.fromRegistry(appImageAsset.imageUri),
        containerPort: 80,
      },
      publicLoadBalancer: true,
      assignPublicIp: true,
    });

    Aspects.of(appService).add({
      visit: (node) => {
        if (node instanceof ecs.CfnTaskDefinition) {
          node.addPropertyOverride('ContainerDefinitions.0.ReadonlyRootFilesystem', true);
        }
      }
    });

    // Define a volume for mounting to the container
    const cacheVolume = appService.taskDefinition.addVolume({
      name: 'cacheVolume',
    })

    const runVolume = appService.taskDefinition.addVolume({
      name: 'runVolume',
    })

    const tmpVolume = appService.taskDefinition.addVolume({
      name: 'tmpVolume',
    })

    const confVolume = appService.taskDefinition.addVolume({
      name: 'confVolume',
    })

    // Override the container definition to mount the root filesystem 
    appService.taskDefinition.defaultContainer?.addMountPoints({
      containerPath: '/var/cache/nginx',
      readOnly: false,
      sourceVolume: 'cacheVolume',
    });

    appService.taskDefinition.defaultContainer?.addMountPoints({
      containerPath: '/var/run',
      readOnly: false,
      sourceVolume: 'runVolume',
    });

    appService.taskDefinition.defaultContainer?.addMountPoints({
      containerPath: '/tmp/nginx',
      readOnly: false,
      sourceVolume: 'tmpVolume',
    });

    appService.taskDefinition.defaultContainer?.addMountPoints({
      containerPath: '/etc/nginx',
      readOnly: false,
      sourceVolume: 'confVolume',
    });

    // Grant ECR repository permissions for the task execution role
    appImageAsset.repository.grantPullPush(appService.taskDefinition.executionRole!);

    // Grant permissions for CloudWatch Logs
    const logGroup = new logs.LogGroup(this, 'MyLogGroup', {
      logGroupName: '/ecs/my-fargate-service',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    logGroup.grantWrite(appService.taskDefinition.executionRole!);

  }
}
